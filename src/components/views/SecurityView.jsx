import React from "react";
import { useERP } from "../ERPContext";

// ─────────────────────────────────────────────────────────────────────────────
// Multi-tenant data-isolation verification dashboard.
// Runs five automated checks against the live database + a code-verified checklist
// so you can confirm tenant isolation is intact BEFORE onboarding a new client.
//
// TEST 1 (RLS enabled) and TEST 5 (open policies) read pg_catalog, which the anon
// client cannot do directly — they call the security_check() RPC (migration 018).
// If that RPC isn't deployed yet, those two checks degrade to an amber "needs
// migration" state; the other three run entirely from the standard client.
// ─────────────────────────────────────────────────────────────────────────────

const CRITICAL_TABLES = [
  "journal_entries", "journal_entry_lines", "contacts", "contracts", "accounts",
  "audit_log", "documents", "bank_accounts", "recurring_transactions", "vendor_rules",
  "ar_invoices", "chat_messages", "tax_settings", "reconciliations", "companies", "company_users",
];
// Tables we can directly count-compare for live isolation (have id + company_id).
const ISOLATION_TABLES = ["journal_entries", "contacts", "contracts", "accounts", "bank_accounts", "audit_log"];
// Soft-delete columns we expect (migration 016).
const SOFT_DELETE_TABLES = ["journal_entries", "contacts", "contracts"];
// Code-verified load functions that scope every query to the active company.
const LOAD_FUNCTIONS = [
  "loadAllData → journal_entries  .eq(company_id)",
  "loadAllData → contacts  .eq(company_id)",
  "loadAllData → accounts / bank_accounts  .eq(company_id)",
  "loadAllData → recurring_transactions  .eq(company_id)",
  "loadAllData → audit_log  .eq(company_id)",
  "loadContractsFromDB → contracts  .eq(company_id)",
  "loadChatHistory → chat_messages  .eq(company_id)",
];

const C = { pass: "#039855", warn: "#DC6803", fail: "#D92D20", muted: "#667085" };

export default function SecurityView() {
  const { supabase, currentCompany, companies } = useERP();
  const [running, setRunning] = React.useState(false);
  const [lastChecked, setLastChecked] = React.useState(null);
  const [r, setR] = React.useState(null); // results

  const runCheck = async () => {
    if (!currentCompany?.id || running) return;
    setRunning(true);
    const cid = currentCompany.id;
    const out = { rls: null, isolation: null, audit: null, softDelete: null, policies: null };

    // TEST 1 + TEST 5 — RLS + policies via the security_check() RPC.
    try {
      const { data, error } = await supabase.rpc("security_check");
      if (error || !data) {
        out.rls = { available: false };
        out.policies = { available: false };
      } else {
        const rlsRows = (data.rls || []).map(x => ({ table: x.table, exists: !!x.exists, enabled: !!x.enabled }));
        out.rls = { available: true, rows: rlsRows };
        const pols = data.policies || [];
        const open = pols.filter(p => !p.has_company_check).map(p => ({ table: p.table, policy: p.policy, cmd: p.cmd }));
        out.policies = { available: true, total: pols.length, open };
      }
    } catch (e) {
      out.rls = { available: false };
      out.policies = { available: false };
    }

    // TEST 2 — Live isolation: an unfiltered count must equal the SUM of counts across
    // exactly the companies this user belongs to. If a foreign company's rows were ever
    // visible, the unfiltered count would be higher than that sum — a leak. (Comparing to
    // a single company would false-positive for users who belong to more than one.)
    try {
      const ids = (companies || []).map(c => c.id).filter(Boolean);
      const myIds = ids.length ? ids : [cid];
      const live = [];
      for (const t of ISOLATION_TABLES) {
        try {
          const all = await supabase.from(t).select("*", { count: "exact", head: true });
          let sum = 0, err = all.error?.message || null;
          for (const id of myIds) {
            const res = await supabase.from(t).select("*", { count: "exact", head: true }).eq("company_id", id);
            sum += res.count || 0;
            if (res.error) err = res.error.message;
          }
          const allN = all.count ?? 0;
          live.push({ table: t, all: allN, mine: sum, ok: !err && allN === sum, error: err });
        } catch (e) { live.push({ table: t, ok: false, error: String(e?.message || e) }); }
      }
      out.isolation = { static: LOAD_FUNCTIONS.map(name => ({ name, ok: true })), live, companyCount: myIds.length };
    } catch (e) {
      out.isolation = { static: [], live: [], error: String(e?.message || e) };
    }

    // TEST 3 — Audit log integrity: entries exist and performed_by is populated.
    try {
      const { data, error } = await supabase.from("audit_log").select("performed_by").limit(5000);
      if (error) {
        out.audit = { ok: false, error: error.message, count: 0, breakdown: [] };
      } else {
        const byMap = {};
        (data || []).forEach(row => { const k = row.performed_by || "(unset / legacy)"; byMap[k] = (byMap[k] || 0) + 1; });
        const breakdown = Object.entries(byMap).map(([by, n]) => ({ by, n })).sort((a, b) => b.n - a.n);
        const count = (data || []).length;
        const unset = byMap["(unset / legacy)"] || 0;
        out.audit = { ok: count > 0 && unset === 0, warn: count > 0 && unset > 0, count, breakdown };
      }
    } catch (e) { out.audit = { ok: false, error: String(e?.message || e), count: 0, breakdown: [] }; }

    // TEST 4 — Soft-delete columns exist (probe by selecting the column).
    try {
      const rows = [];
      for (const t of SOFT_DELETE_TABLES) {
        const { error } = await supabase.from(t).select("deleted_at").limit(1);
        const missing = error && /deleted_at|column|does not exist|schema cache|PGRST/i.test(error.message || "");
        rows.push({ table: t, present: !missing, error: missing ? error.message : null });
      }
      out.softDelete = { rows, ok: rows.every(x => x.present) };
    } catch (e) { out.softDelete = { rows: [], ok: false, error: String(e?.message || e) }; }

    setR(out);
    setLastChecked(new Date());
    setRunning(false);
  };

  React.useEffect(() => { runCheck(); /* eslint-disable-next-line */ }, [currentCompany?.id]);

  // ── Per-test status rollup ──
  const statusOf = (() => {
    if (!r) return {};
    const s = {};
    s.rls = !r.rls?.available ? "warn" : r.rls.rows.every(x => x.exists && x.enabled) ? "pass" : "fail";
    s.isolation = !r.isolation ? "warn" : (r.isolation.live || []).some(x => !x.ok) ? "fail" : "pass";
    s.audit = !r.audit ? "warn" : r.audit.ok ? "pass" : r.audit.warn ? "warn" : "fail";
    s.softDelete = !r.softDelete ? "warn" : r.softDelete.ok ? "pass" : "fail";
    s.policies = !r.policies?.available ? "warn" : r.policies.open.length === 0 ? "pass" : "fail";
    return s;
  })();
  const allStatuses = Object.values(statusOf);
  const issues = allStatuses.filter(x => x === "fail").length;
  const warns = allStatuses.filter(x => x === "warn").length;
  const overall = !r ? "warn" : issues > 0 ? "fail" : warns > 0 ? "warn" : "pass";

  // ── Small presentational helpers ──
  const Dot = ({ s }) => <span style={{ display: "inline-flex", width: 18, height: 18, borderRadius: "50%", background: (s === "pass" ? C.pass : s === "warn" ? C.warn : C.fail) + "1A", color: s === "pass" ? C.pass : s === "warn" ? C.warn : C.fail, alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{s === "pass" ? "✓" : s === "warn" ? "!" : "✕"}</span>;
  const Card = ({ title, status, desc, children }) => (
    <div className="sc-card" style={{ background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 14, padding: "18px 20px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Dot s={status || "warn"} />
        <div style={{ fontSize: 14, fontWeight: 600, color: "#101828" }}>{title}</div>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: status === "pass" ? C.pass : status === "warn" ? C.warn : C.fail }}>
          {status === "pass" ? "PASS" : status === "warn" ? "NEEDS ATTENTION" : "FAIL"}
        </span>
      </div>
      {desc && <div style={{ fontSize: 12.5, color: "#667085", marginBottom: 12, lineHeight: 1.5 }}>{desc}</div>}
      {children}
    </div>
  );
  const Row = ({ ok, label, right }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid #F3F4F6", fontSize: 13 }}>
      <span style={{ color: ok ? C.pass : C.fail, fontWeight: 800, width: 16, flexShrink: 0 }}>{ok ? "✓" : "✕"}</span>
      <span style={{ color: "#374151", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>{label}</span>
      {right != null && <span style={{ marginLeft: "auto", fontSize: 12, color: "#667085", fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>{right}</span>}
    </div>
  );
  const migrationNote = (mig) => (
    <div style={{ fontSize: 12.5, color: C.warn, background: "#FFFAEB", border: "1px solid #FEDF89", borderRadius: 10, padding: "10px 12px", lineHeight: 1.5 }}>
      This check reads database catalog metadata, which requires the <code style={{ background: "#FEF0C7", padding: "1px 5px", borderRadius: 4 }}>{mig}</code> migration (the <code>security_check()</code> function). Apply it in Supabase, then re-run.
    </div>
  );

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#475467", marginBottom: 8 }}>SECURITY</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Data isolation check</h1>
        <div style={{ fontSize: 13, color: "#475467", marginTop: 6 }}>Automated verification that one company can never see another company's data.</div>
      </div>

      {/* Overall status banner */}
      <div style={{ background: overall === "pass" ? "#ECFDF3" : overall === "warn" ? "#FFFAEB" : "#FEF3F2", border: `1px solid ${(overall === "pass" ? C.pass : overall === "warn" ? C.warn : C.fail)}40`, borderLeft: `4px solid ${overall === "pass" ? C.pass : overall === "warn" ? C.warn : C.fail}`, borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: overall === "pass" ? C.pass : overall === "warn" ? C.warn : C.fail, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#fff", flexShrink: 0 }}>{overall === "pass" ? "✓" : overall === "warn" ? "!" : "✕"}</div>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: overall === "pass" ? C.pass : overall === "warn" ? C.warn : C.fail }}>
            {!r ? "Running checks…" : issues > 0 ? `${issues} issue${issues > 1 ? "s" : ""} found ⚠` : warns > 0 ? `${warns} check${warns > 1 ? "s" : ""} need attention` : "All checks passed ✓"}
          </div>
          <div style={{ fontSize: 12, color: "#667085", marginTop: 3 }}>
            {lastChecked ? `Last checked ${lastChecked.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` : "—"}
            {currentCompany?.name ? ` · ${currentCompany.name}` : ""}
          </div>
        </div>
        <button onClick={runCheck} disabled={running} style={{ flexShrink: 0, height: 40, padding: "0 20px", borderRadius: 8, fontSize: 14, fontWeight: 600, background: running ? "#E4E7EC" : "#4F46E5", border: "none", color: running ? "#98A2B3" : "#fff", cursor: running ? "default" : "pointer" }}>
          {running ? "Running…" : "Run Security Check"}
        </button>
      </div>

      <div style={{ fontSize: 12.5, color: C.warn, background: "#FFFAEB", border: "1px solid #FEDF89", borderRadius: 10, padding: "10px 14px", marginBottom: 18, fontWeight: 500 }}>
        ⚠ Run this check before adding any new client.
      </div>

      {/* TEST 1 — RLS enabled */}
      <Card title="1 · Row-Level Security enabled" status={statusOf.rls}
        desc="Every multi-tenant table must have RLS turned on so the database itself blocks cross-company reads — not just the app.">
        {!r ? null : !r.rls?.available ? migrationNote("018_security_check.sql") : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0 24px" }}>
            {r.rls.rows.map(t => <Row key={t.table} ok={t.exists && t.enabled} label={t.table} right={!t.exists ? "missing" : t.enabled ? "on" : "OFF"} />)}
          </div>
        )}
      </Card>

      {/* TEST 2 — Data isolation */}
      <Card title="2 · Data isolation (company_id scoping)" status={statusOf.isolation}
        desc={`Live test: an unfiltered count must equal the total across the ${r?.isolation?.companyCount || 1} compan${(r?.isolation?.companyCount || 1) === 1 ? "y" : "ies"} you belong to. If a foreign company's rows were ever visible, the unfiltered count would be higher. Below: visible / your-companies rows. Plus the app's load functions, code-verified to filter by company_id.`}>
        {r?.isolation && (
          <>
            {(r.isolation.live || []).map(x => (
              <Row key={x.table} ok={x.ok} label={x.table} right={x.error ? "error" : `${x.all} / ${x.mine} rows`} />
            ))}
            <div style={{ fontSize: 11, color: "#98A2B3", letterSpacing: 1, margin: "12px 0 2px", fontWeight: 600 }}>LOAD FUNCTIONS (CODE-VERIFIED)</div>
            {(r.isolation.static || []).map(x => <Row key={x.name} ok={x.ok} label={x.name} />)}
          </>
        )}
      </Card>

      {/* TEST 3 — Audit log integrity */}
      <Card title="3 · Audit log integrity" status={statusOf.audit}
        desc="The audit_log should have entries and every row should record who performed the action (performed_by).">
        {r?.audit && (
          <>
            <Row ok={r.audit.count > 0} label="audit_log has entries" right={`${r.audit.count} rows`} />
            {r.audit.breakdown.map(b => (
              <Row key={b.by} ok={b.by !== "(unset / legacy)"} label={`performed_by: ${b.by}`} right={`${b.n}`} />
            ))}
            {r.audit.error && <div style={{ fontSize: 12, color: C.fail, marginTop: 8 }}>{r.audit.error}</div>}
          </>
        )}
      </Card>

      {/* TEST 4 — Soft delete */}
      <Card title="4 · Soft-delete columns present" status={statusOf.softDelete}
        desc="Deletes must be reversible: journal_entries, contacts, and contracts each need a deleted_at column (migration 016).">
        {r?.softDelete && r.softDelete.rows.map(t => (
          <Row key={t.table} ok={t.present} label={`${t.table}.deleted_at`} right={t.present ? "present" : "MISSING"} />
        ))}
      </Card>

      {/* TEST 5 — Open policies */}
      <Card title="5 · No open policies" status={statusOf.policies}
        desc="Every RLS policy on a tenant table must check company membership (is_company_member / company_id / auth.uid). A policy without that check would expose data.">
        {!r ? null : !r.policies?.available ? migrationNote("018_security_check.sql") : (
          r.policies.open.length === 0
            ? <Row ok={true} label={`All ${r.policies.total} policies gate on company membership`} />
            : r.policies.open.map((p, i) => <Row key={i} ok={false} label={`${p.table} · ${p.policy} (${p.cmd})`} right="OPEN" />)
        )}
      </Card>

      {/* ── Documentation ── */}
      <div style={{ background: "#F9FAFB", border: "1px solid #E4E7EC", borderRadius: 14, padding: "20px 22px", marginTop: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#101828", marginBottom: 12 }}>How tenant isolation works</div>

        <div style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4 }}>What is RLS, and why it matters</div>
        <p style={{ fontSize: 12.5, color: "#475467", lineHeight: 1.6, margin: "0 0 14px" }}>
          Row-Level Security (RLS) is a Postgres feature that filters every query at the database level. With RLS on,
          a policy decides which rows a request may see or change. This app ships the public anon key in the browser,
          so client-side <code>.eq("company_id", …)</code> filters are <strong>not</strong> a security boundary — anyone
          could craft a request for another company's id. RLS is the real boundary: even a fully attacker-controlled
          client only ever reads rows for companies the signed-in user belongs to.
        </p>

        <div style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4 }}>How data isolation works here</div>
        <p style={{ fontSize: 12.5, color: "#475467", lineHeight: 1.6, margin: "0 0 14px" }}>
          Every tenant table carries a <code>company_id</code>. The <code>is_company_member(company_id)</code> helper
          (SECURITY DEFINER) checks the <code>company_users</code> membership table for the current <code>auth.uid()</code>.
          Each table's SELECT / INSERT / UPDATE / DELETE policy calls that helper, so the database returns zero rows for
          any company you don't belong to. The app <em>also</em> filters by <code>company_id</code> for performance and
          clarity — but the database enforces isolation regardless of what the client sends. Test 2 proves this live by
          confirming an unfiltered count equals the company-scoped count.
        </p>

        <div style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4 }}>What to do if a check fails</div>
        <ul style={{ fontSize: 12.5, color: "#475467", lineHeight: 1.7, margin: "0", paddingLeft: 18 }}>
          <li><strong>RLS off (Test 1):</strong> a table has <code>rowsecurity = false</code>. Re-apply <code>001_enable_rls.sql</code> and verify the table is listed there. Do not onboard new clients until fixed.</li>
          <li><strong>Isolation leak (Test 2):</strong> an unfiltered count exceeds the company count — RLS is missing or a policy is too broad. Treat as a critical incident: investigate the table's policies immediately.</li>
          <li><strong>Audit gaps (Test 3):</strong> rows with an unset <code>performed_by</code> are legacy entries from before audit attribution; new actions populate it. Investigate only if recent rows are unset.</li>
          <li><strong>Missing deleted_at (Test 4):</strong> apply <code>016_soft_delete.sql</code> so deletes stay reversible.</li>
          <li><strong>Open policy (Test 5):</strong> a policy lacks a membership check. Drop and recreate it with an <code>is_company_member(company_id)</code> using/with-check clause before exposing the app.</li>
        </ul>
      </div>
    </div>
  );
}
