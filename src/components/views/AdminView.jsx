import React from "react";
import { createPortal } from "react-dom";
import { useERP } from "../ERPContext";
import { fmtDate } from "../../lib/format";
import SecurityView from "./SecurityView";

// ─────────────────────────────────────────────────────────────────────────────
// Platform admin panel. Private operational tool (only mounted when isPlatformAdmin).
// Every cross-company read goes through the SECURITY DEFINER admin RPCs (migration
// 020), which verify is_platform_admin() server-side. Support Mode switches the
// app into a client's context to diagnose/fix things exactly as they see them.
// ─────────────────────────────────────────────────────────────────────────────

const A = { amber: "#DC6803", amberBg: "#FFFAEB", amberBorder: "#FEDF89", red: "#D92D20", green: "#039855", muted: "#667085" };
const fmtMoney = n => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
const fmtBytes = n => {
  const b = Number(n) || 0;
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
};
const dt = ts => ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export default function AdminView() {
  const { supabase, session, enterSupport, showNotification, logAudit } = useERP();
  const [tab, setTab] = React.useState("clients");

  const rpc = async (name, args, { silent } = {}) => {
    try {
      const { data, error } = await supabase.rpc(name, args);
      if (error) {
        // A not-yet-deployed function (migration pending) degrades quietly.
        const missing = /does not exist|PGRST202|schema cache|could not find/i.test(error.message || "");
        if (!missing) console.error(name, error.message);
        if (!missing && !silent) showNotification(`${name}: ${error.message}`, "error");
        return null;
      }
      return data;
    } catch (e) { console.error(name, e); if (!silent) showNotification(`${name} failed`, "error"); return null; }
  };

  const TABS = [["clients", "Clients"], ["problems", "Problems"], ["stats", "Stats"], ["recovery", "Data Recovery"], ["system", "System"]];

  return (
    <div>
      <div style={{ marginBottom: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: A.amber, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>⚙</div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: A.amber, marginBottom: 4, fontWeight: 600 }}>PLATFORM ADMIN</div>
          <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Operations</h1>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid #E4E7EC", flexWrap: "wrap" }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: "9px 16px", background: "none", border: "none", borderBottom: tab === id ? `2px solid ${A.amber}` : "2px solid transparent", color: tab === id ? A.amber : "#475467", fontSize: 14, fontWeight: tab === id ? 600 : 500, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "clients" && <ClientsTab rpc={rpc} enterSupport={enterSupport} showNotification={showNotification} logAudit={logAudit} supabase={supabase} />}
      {tab === "problems" && <ProblemsTab rpc={rpc} enterSupport={enterSupport} />}
      {tab === "stats" && <StatsTab rpc={rpc} />}
      {tab === "recovery" && <RecoveryTab rpc={rpc} showNotification={showNotification} />}
      {tab === "system" && <SystemTab rpc={rpc} />}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────
const Card = ({ title, right, children, accent }) => (
  <div className="sc-card" style={{ background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 12, marginBottom: 16, overflow: "clip" }}>
    {title && (
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #EEF0F4", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: accent || "#101828" }}>{title}</div>
        {right}
      </div>
    )}
    {children}
  </div>
);
const Th = ({ children, align }) => <th style={{ padding: "9px 12px", textAlign: align || "left", fontSize: 11, color: "#98A2B3", letterSpacing: 0.5, fontWeight: 600, borderBottom: "1px solid #E4E7EC", whiteSpace: "nowrap" }}>{String(children).toUpperCase()}</th>;
const Td = ({ children, align, mono, color }) => <td style={{ padding: "9px 12px", textAlign: align || "left", fontSize: 13, color: color || "#374151", fontFamily: mono ? "'DM Mono',monospace" : "inherit", whiteSpace: "nowrap" }}>{children}</td>;
const Empty = ({ children }) => <div style={{ padding: 28, textAlign: "center", color: A.muted, fontSize: 13 }}>{children}</div>;
const Loading = () => <div style={{ padding: 28, textAlign: "center", color: A.muted, fontSize: 13 }}>Loading…</div>;
const btn = (bg, color, border) => ({ padding: "5px 11px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: bg, color, border: border || "none", cursor: "pointer", whiteSpace: "nowrap" });
// Compact button for dense action groups (Clients table).
const btnSm = (bg, color, border) => ({ padding: "4px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: bg, color, border: border || "none", cursor: "pointer", whiteSpace: "nowrap", lineHeight: 1.3 });

// ═══ SECTION 1: CLIENTS ═══
function ClientsTab({ rpc, enterSupport, showNotification, supabase }) {
  const [rows, setRows] = React.useState(null);
  const [modal, setModal] = React.useState(null); // { kind:"audit"|"uploads", company }
  React.useEffect(() => { rpc("get_admin_company_stats").then(d => setRows(d || [])); }, []); // eslint-disable-line

  const statusBadge = (s) => {
    const map = { active: [A.green, "Active"], idle: [A.amber, "Idle"], churned: [A.red, "Churned?"] };
    const [c, label] = map[s] || [A.muted, s];
    return <span style={{ fontSize: 11, fontWeight: 600, color: c, background: c + "14", border: `1px solid ${c}33`, borderRadius: 20, padding: "2px 9px" }}>{label}</span>;
  };
  const resetPassword = async (email) => {
    if (!email) { showNotification("No owner email on file.", "error"); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    showNotification(error ? `Reset failed: ${error.message}` : `Password reset email sent to ${email} ✓`, error ? "error" : "success");
  };

  if (!rows) return <Loading />;
  return (
    <>
      <Card title={`All companies (${rows.length})`} accent={A.amber}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#F9FAFB" }}>
              {["Company", "Owner", "Created", "Last active", "Txns", "Docs", "Failed 7d", "Storage", "Status", ""].map((h, i) => <Th key={i} align={["Txns", "Docs", "Failed 7d", "Storage"].includes(h) ? "right" : "left"}>{h}</Th>)}
            </tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={10}><Empty>No companies yet.</Empty></td></tr> : rows.map(r => (
                <tr key={r.company_id} style={{ borderBottom: "1px solid #F2F4F7" }}>
                  <td style={{ padding: "9px 12px", fontSize: 13, color: "#101828", fontWeight: 600, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</td>
                  <td style={{ padding: "9px 12px", fontSize: 13, color: A.muted, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.owner_email || ""}>{r.owner_email || "—"}</td>
                  <Td color={A.muted}>{fmtDate(r.created_at)}</Td>
                  <Td color={A.muted}>{r.last_active ? fmtDate(r.last_active) : "never"}</Td>
                  <Td align="right" mono>{r.txn_count}</Td>
                  <Td align="right" mono>{r.doc_count}</Td>
                  <Td align="right" mono color={r.failed_uploads_7d > 0 ? A.red : A.muted}>{r.failed_uploads_7d}</Td>
                  <Td align="right" mono>{fmtBytes(r.storage_bytes)}</Td>
                  <Td>{statusBadge(r.status)}</Td>
                  <Td>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <button onClick={() => enterSupport({ id: r.company_id, name: r.name })} style={btnSm("#EA580C", "#fff")}>Support</button>
                      <button onClick={() => setModal({ kind: "audit", company: r })} style={btnSm("#EEF2FF", "#4F46E5", "1px solid #4F46E533")}>Audit</button>
                      <button onClick={() => setModal({ kind: "uploads", company: r })} style={btnSm("#EEF2FF", "#4F46E5", "1px solid #4F46E533")}>Uploads</button>
                      <button onClick={() => resetPassword(r.owner_email)} style={btnSm("#FFFFFF", "#475467", "1px solid #D0D5DD")}>Reset PW</button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {modal && <CompanyModal rpc={rpc} modal={modal} onClose={() => setModal(null)} />}
    </>
  );
}

function CompanyModal({ rpc, modal, onClose }) {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    setData(null);
    const fn = modal.kind === "audit" ? "get_admin_company_audit" : "get_admin_company_uploads";
    rpc(fn, { p_company_id: modal.company.company_id, p_limit: 500 }).then(d => setData(d || []));
  }, [modal.kind, modal.company.company_id]); // eslint-disable-line

  return createPortal((
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(17,24,39,0.4)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "48px 24px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 900, maxWidth: "96vw", background: "#FFFFFF", borderRadius: 14, boxShadow: "0 24px 80px rgba(16,24,40,0.3)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #EEF0F4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{modal.company.name} — {modal.kind === "audit" ? "Audit Trail" : "Upload History"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "#475467", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {!data ? <Loading /> : data.length === 0 ? <Empty>Nothing recorded.</Empty> : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              {modal.kind === "audit" ? (
                <>
                  <thead><tr style={{ background: "#F9FAFB" }}><Th>When</Th><Th>Action</Th><Th>Detail</Th><Th>By</Th></tr></thead>
                  <tbody>{data.map((a, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #F2F4F7" }}>
                      <Td color={A.muted} mono>{dt(a.created_at)}</Td>
                      <Td><span style={{ fontSize: 11, background: "#EEF2FF", color: "#4F46E5", borderRadius: 20, padding: "2px 8px" }}>{(a.action || "").replace(/_/g, " ")}</span></Td>
                      <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151" }}>{a.detail}</td>
                      <Td color={a.performed_by === "AI Chat" ? "#4F46E5" : a.performed_by?.startsWith("Platform Admin") ? A.amber : A.muted}>{a.performed_by || "—"}</Td>
                    </tr>
                  ))}</tbody>
                </>
              ) : (
                <>
                  <thead><tr style={{ background: "#F9FAFB" }}><Th>When</Th><Th>File</Th><Th>Type</Th><Th>Status</Th><Th>Detail</Th></tr></thead>
                  <tbody>{data.map((u, i) => {
                    const sc = u.status === "done" ? A.green : u.status === "error" ? A.red : A.amber;
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #F2F4F7" }}>
                        <Td color={A.muted} mono>{dt(u.created_at)}</Td>
                        <Td color="#101828">{u.file_name}</Td>
                        <Td color={A.muted}>{u.doc_type || "—"}</Td>
                        <Td><span style={{ fontSize: 11, fontWeight: 600, color: sc, background: sc + "14", borderRadius: 20, padding: "2px 8px" }}>{u.status}</span></Td>
                        <td style={{ padding: "10px 14px", fontSize: 12, color: u.error ? A.red : A.muted, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.error || (u.result ? JSON.stringify(u.result) : "")}</td>
                      </tr>
                    );
                  })}</tbody>
                </>
              )}
            </table>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}

// ═══ SECTION 2: PROBLEMS ═══
function ProblemsTab({ rpc, enterSupport }) {
  const [days, setDays] = React.useState(1);
  const [failed, setFailed] = React.useState(null);
  const [orphans, setOrphans] = React.useState(null);
  const [stuck, setStuck] = React.useState(null);
  const [dupes, setDupes] = React.useState(null);
  const [errors, setErrors] = React.useState(null);
  const [vis, setVis] = React.useState(null);   // booking_visibility_failure events (30d, all companies)

  React.useEffect(() => { rpc("get_admin_failed_uploads", { p_days: days }).then(d => setFailed(d || [])); }, [days]); // eslint-disable-line
  React.useEffect(() => {
    rpc("get_admin_orphaned_documents").then(d => setOrphans(d || []));
    rpc("get_admin_stuck_uploads").then(d => setStuck(d || []));
    rpc("get_admin_duplicate_entries").then(d => setDupes(d || []));
    rpc("get_admin_recent_errors", { p_limit: 50 }).then(d => setErrors(d || []));
    rpc("get_admin_visibility_failures", { p_days: 30 }, { silent: true }).then(d => setVis(d || []));
  }, []); // eslint-disable-line

  const openSupport = (cid, name) => enterSupport({ id: cid, name });
  const visCompanies = vis ? new Set(vis.map(v => v.company_id)).size : 0;

  return (
    <>
      {/* Booking-visibility failures — a saved entry that didn't show up in the ledger. */}
      <Card accent={vis && vis.length ? A.red : A.green} title="Booking visibility failures (30d)">
        {vis === null ? <Loading /> : vis.length === 0 ? <Empty>No booking-visibility failures in the last 30 days 🎉</Empty> : (
          <>
            <div style={{ padding: "12px 18px", display: "flex", alignItems: "baseline", gap: 10, borderBottom: "1px solid #F2F4F7" }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: A.red, fontFamily: "'DM Mono',monospace" }}>{vis.length}</span>
              <span style={{ fontSize: 13, color: "#475467" }}>event{vis.length !== 1 ? "s" : ""} across {visCompanies} compan{visCompanies !== 1 ? "ies" : "y"} — investigate immediately</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#F9FAFB" }}><Th>When</Th><Th>Company</Th><Th>Detail</Th><Th></Th></tr></thead>
              <tbody>{vis.slice(0, 50).map((v, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #F2F4F7" }}>
                  <Td color={A.muted} mono>{dt(v.created_at)}</Td>
                  <Td color="#101828">{v.company_name || "—"}</Td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: "#374151" }}>{v.detail}</td>
                  <Td>{v.company_id && <button onClick={() => openSupport(v.company_id, v.company_name)} style={btn("#EA580C", "#fff")}>Open in Support</button>}</Td>
                </tr>
              ))}</tbody>
            </table>
          </>
        )}
      </Card>

      <Card accent={A.red} title={`Failed uploads`} right={
        <div style={{ display: "flex", gap: 4 }}>
          {[[1, "24h"], [7, "7d"], [30, "30d"]].map(([d, l]) => (
            <button key={d} onClick={() => setDays(d)} style={{ padding: "4px 11px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", background: days === d ? A.amber : "#FFFFFF", color: days === d ? "#fff" : "#475467", border: `1px solid ${days === d ? A.amber : "#D0D5DD"}` }}>{l}</button>
          ))}
        </div>}>
        {!failed ? <Loading /> : failed.length === 0 ? <Empty>No failed uploads in this window 🎉</Empty> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#F9FAFB" }}><Th>Company</Th><Th>File</Th><Th>Error</Th><Th>When</Th><Th></Th></tr></thead>
            <tbody>{failed.map(f => (
              <tr key={f.id} style={{ borderBottom: "1px solid #F2F4F7" }}>
                <Td color="#101828">{f.company_name}</Td>
                <Td>{f.file_name}{f.has_storage && <span title="File is in storage — can be reprocessed" style={{ marginLeft: 6, fontSize: 10, color: A.green }}>● stored</span>}</Td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: A.red, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.error}</td>
                <Td color={A.muted} mono>{dt(f.created_at)}</Td>
                <Td><button onClick={() => openSupport(f.company_id, f.company_name)} style={btn("#EA580C", "#fff")}>Open in Support</button></Td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <Card accent={A.red} title="Recent errors (all companies)">
        {!errors ? <Loading /> : errors.length === 0 ? <Empty>No recent errors.</Empty> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#F9FAFB" }}><Th>When</Th><Th>Company</Th><Th>Action</Th><Th>Detail</Th></tr></thead>
            <tbody>{errors.map((e, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #F2F4F7" }}>
                <Td color={A.muted} mono>{dt(e.created_at)}</Td>
                <Td>{e.company_name || "—"}</Td>
                <Td><span style={{ fontSize: 11, color: A.red, background: A.red + "14", borderRadius: 20, padding: "2px 8px" }}>{(e.action || "").replace(/_/g, " ")}</span></Td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: "#374151" }}>{e.detail}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
        <Card accent={A.amber} title="Stuck uploads (>10 min)">
          {!stuck ? <Loading /> : stuck.length === 0 ? <Empty>Nothing stuck.</Empty> : stuck.map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 18px", borderTop: "1px solid #F2F4F7" }}>
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, color: "#101828" }}>{s.file_name}</div><div style={{ fontSize: 11, color: A.muted }}>{s.company_name} · stuck {s.minutes_stuck}m</div></div>
              <button onClick={() => openSupport(s.company_id, s.company_name)} style={btn("#FFFFFF", "#475467", "1px solid #D0D5DD")}>Open</button>
            </div>
          ))}
        </Card>

        <Card accent={A.amber} title="Orphaned documents">
          {!orphans ? <Loading /> : orphans.length === 0 ? <Empty>No orphaned documents.</Empty> : orphans.slice(0, 50).map((o, i) => (
            <div key={i} style={{ padding: "10px 18px", borderTop: "1px solid #F2F4F7" }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#101828", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.file_name}</div>
              <div style={{ fontSize: 11, color: A.muted }}>{o.company_name} · {o.detail} · {fmtDate(o.created_at)}</div>
            </div>
          ))}
        </Card>
      </div>

      <Card accent={A.amber} title="Possible duplicate entries (same vendor · amount · date)">
        {!dupes ? <Loading /> : dupes.length === 0 ? <Empty>No duplicates detected.</Empty> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#F9FAFB" }}><Th>Company</Th><Th>Vendor</Th><Th>Date</Th><Th align="right">Amount</Th><Th align="right">Count</Th></tr></thead>
            <tbody>{dupes.map((d, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #F2F4F7" }}>
                <Td>{d.company_name}</Td><Td color="#101828">{d.vendor}</Td><Td color={A.muted}>{fmtDate(d.entry_date)}</Td>
                <Td align="right" mono>{fmtMoney(d.amount)}</Td>
                <Td align="right"><span style={{ fontSize: 11, fontWeight: 700, color: A.red, background: A.red + "14", borderRadius: 20, padding: "1px 8px" }}>{d.cnt}×</span></Td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}

// ═══ SECTION 3: STATS ═══
function StatsTab({ rpc }) {
  const [s, setS] = React.useState(null);
  React.useEffect(() => { rpc("get_admin_platform_stats").then(setS); }, []); // eslint-disable-line
  if (!s) return <Loading />;
  const aiCalls = s.ai_calls_estimate || 0;
  const aiCost = aiCalls * 0.012; // rough blended per-call estimate (Haiku classify + Sonnet extract/code)

  const Metric = ({ label, value, sub }) => (
    <div className="sc-card" style={{ background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 12, padding: "18px 20px" }}>
      <div style={{ fontSize: 12, color: A.muted, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'DM Mono',monospace", letterSpacing: -1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: A.muted, marginTop: 6 }}>{sub}</div>}
    </div>
  );
  const maxMonth = Math.max(1, ...((s.companies_by_month || []).map(m => m.count)));

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, marginBottom: 20 }}>
        <Metric label="COMPANIES" value={s.total_companies} />
        <Metric label="TRANSACTIONS" value={(s.total_transactions || 0).toLocaleString()} sub={`${(s.transactions_this_month || 0).toLocaleString()} this month`} />
        <Metric label="DOCUMENTS" value={(s.total_documents || 0).toLocaleString()} sub={`${s.storage_gb} GB stored`} />
        <Metric label="AI CHAT MESSAGES" value={(s.total_chat_messages || 0).toLocaleString()} />
        <Metric label="UPLOAD SUCCESS" value={s.upload_success_rate != null ? `${s.upload_success_rate}%` : "—"} sub="result in a booked entry" />
        <Metric label="EST. AI CALLS" value={aiCalls.toLocaleString()} sub={`~${fmtMoney(aiCost)}/mo est. Anthropic`} />
      </div>

      <Card title="New companies by month">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "20px 18px", height: 140 }}>
          {(s.companies_by_month || []).length === 0 ? <Empty>No data.</Empty> : (s.companies_by_month || []).map(m => (
            <div key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: A.muted, fontFamily: "'DM Mono',monospace" }}>{m.count}</div>
              <div style={{ width: "100%", maxWidth: 40, height: `${(m.count / maxMonth) * 90}px`, minHeight: 3, background: "linear-gradient(180deg,#F59E0B,#DC6803)", borderRadius: "4px 4px 0 0" }} />
              <div style={{ fontSize: 10, color: A.muted, whiteSpace: "nowrap" }}>{m.month?.slice(2)}</div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
        <Card title="Most active companies (top 10)">
          {(s.top_companies || []).map((c, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 18px", borderTop: i ? "1px solid #F2F4F7" : "none", fontSize: 13 }}>
              <span style={{ color: "#101828" }}><span style={{ color: A.muted, marginRight: 8 }}>{i + 1}.</span>{c.name}</span>
              <span style={{ fontFamily: "'DM Mono',monospace", color: A.muted }}>{c.txns} txns</span>
            </div>
          ))}
        </Card>
        <Card title="Feature usage (audit actions)">
          {(s.feature_usage || []).map((f, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 18px", borderTop: i ? "1px solid #F2F4F7" : "none", fontSize: 13 }}>
              <span style={{ color: "#374151" }}>{(f.action || "").replace(/_/g, " ")}</span>
              <span style={{ fontFamily: "'DM Mono',monospace", color: A.muted }}>{f.count}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

// ═══ SECTION 4: DATA RECOVERY ═══
function RecoveryTab({ rpc, showNotification }) {
  const [companies, setCompanies] = React.useState([]);
  const [f, setF] = React.useState({ company: "", from: "", to: "", vendor: "", amount: "", includeDeleted: true });
  const [results, setResults] = React.useState(null);
  const [fileQ, setFileQ] = React.useState("");
  const [fileRes, setFileRes] = React.useState(null);
  React.useEffect(() => { rpc("get_admin_company_stats").then(d => setCompanies(d || [])); }, []); // eslint-disable-line

  const search = async () => {
    const data = await rpc("get_admin_search_entries", {
      p_company_id: f.company || null,
      p_from: f.from || null, p_to: f.to || null,
      p_vendor: f.vendor.trim() || null,
      p_amount: f.amount !== "" ? Number(f.amount) : null,
      p_include_deleted: f.includeDeleted,
    });
    setResults(data || []);
  };
  const traceFile = async () => {
    if (!fileQ.trim()) return;
    setFileRes(await rpc("get_admin_trace_file", { p_file: fileQ.trim() }) || []);
  };
  const restore = async (id) => {
    const r = await rpc("restore_deleted_entry", { p_entry_id: id });
    if (r?.restored) { showNotification("Entry restored — it's back in the client's books ✓"); search(); }
  };

  const inp = { background: "#FFFFFF", border: "1px solid #D0D5DD", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#101828", outline: "none" };
  return (
    <>
      <Card title="Search all entries (including soft-deleted)" accent={A.amber}>
        <div style={{ padding: "16px 18px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><div style={{ fontSize: 11, color: A.muted, marginBottom: 4 }}>Company</div>
            <select value={f.company} onChange={e => setF(s => ({ ...s, company: e.target.value }))} style={{ ...inp, minWidth: 200 }}>
              <option value="">All companies</option>
              {companies.map(c => <option key={c.company_id} value={c.company_id}>{c.name}</option>)}
            </select></div>
          <div><div style={{ fontSize: 11, color: A.muted, marginBottom: 4 }}>From</div><input type="date" value={f.from} onChange={e => setF(s => ({ ...s, from: e.target.value }))} style={inp} /></div>
          <div><div style={{ fontSize: 11, color: A.muted, marginBottom: 4 }}>To</div><input type="date" value={f.to} onChange={e => setF(s => ({ ...s, to: e.target.value }))} style={inp} /></div>
          <div><div style={{ fontSize: 11, color: A.muted, marginBottom: 4 }}>Vendor</div><input value={f.vendor} onChange={e => setF(s => ({ ...s, vendor: e.target.value }))} placeholder="name…" style={inp} /></div>
          <div><div style={{ fontSize: 11, color: A.muted, marginBottom: 4 }}>Amount</div><input type="number" value={f.amount} onChange={e => setF(s => ({ ...s, amount: e.target.value }))} placeholder="0.00" style={{ ...inp, width: 110 }} /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#374151", cursor: "pointer", paddingBottom: 8 }}>
            <input type="checkbox" checked={f.includeDeleted} onChange={e => setF(s => ({ ...s, includeDeleted: e.target.checked }))} /> Include deleted
          </label>
          <button onClick={search} style={{ ...btn(A.amber, "#fff"), height: 36, padding: "0 18px", fontSize: 14, borderRadius: 8 }}>Search</button>
        </div>
        {results && (results.length === 0 ? <Empty>No matching entries.</Empty> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#F9FAFB" }}><Th>Date</Th><Th>Company</Th><Th>Vendor</Th><Th>Description</Th><Th align="right">Amount</Th><Th>State</Th><Th></Th></tr></thead>
            <tbody>{results.map(r => (
              <tr key={r.id} style={{ borderBottom: "1px solid #F2F4F7", background: r.deleted_at ? "#FEF3F2" : "transparent" }}>
                <Td color={A.muted}>{fmtDate(r.entry_date)}</Td>
                <Td color={A.muted}>{r.company_name}</Td>
                <Td color="#101828">{r.vendor}</Td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: "#475467", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</td>
                <Td align="right" mono>{fmtMoney(r.amount)}</Td>
                <Td>{r.deleted_at
                  ? <span title={`Deleted ${dt(r.deleted_at)}${r.deleted_by_email ? " by " + r.deleted_by_email : ""}`} style={{ fontSize: 11, fontWeight: 700, color: A.red, background: A.red + "14", border: `1px solid ${A.red}33`, borderRadius: 20, padding: "2px 9px" }}>DELETED</span>
                  : <span style={{ fontSize: 11, color: A.green }}>live</span>}</Td>
                <Td>{r.deleted_at && <button onClick={() => restore(r.id)} style={btn(A.green, "#fff")}>Restore</button>}</Td>
              </tr>
            ))}</tbody>
          </table>
        ))}
      </Card>

      <Card title="Trace a file → upload record" accent={A.amber}>
        <div style={{ padding: "16px 18px", display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}><div style={{ fontSize: 11, color: A.muted, marginBottom: 4 }}>File name (partial)</div><input value={fileQ} onChange={e => setFileQ(e.target.value)} onKeyDown={e => e.key === "Enter" && traceFile()} placeholder="invoice.pdf" style={{ ...inp, width: "100%", boxSizing: "border-box" }} /></div>
          <button onClick={traceFile} style={{ ...btn(A.amber, "#fff"), height: 36, padding: "0 18px", fontSize: 14, borderRadius: 8 }}>Trace</button>
        </div>
        {fileRes && (fileRes.length === 0 ? <Empty>No upload records match.</Empty> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#F9FAFB" }}><Th>When</Th><Th>Company</Th><Th>File</Th><Th>Type</Th><Th>Status</Th><Th>Detail</Th></tr></thead>
            <tbody>{fileRes.map(u => {
              const sc = u.status === "done" ? A.green : u.status === "error" ? A.red : A.amber;
              return (
                <tr key={u.upload_id} style={{ borderBottom: "1px solid #F2F4F7" }}>
                  <Td color={A.muted} mono>{dt(u.created_at)}</Td><Td>{u.company_name}</Td><Td color="#101828">{u.file_name}</Td>
                  <Td color={A.muted}>{u.doc_type || "—"}</Td>
                  <Td><span style={{ fontSize: 11, fontWeight: 600, color: sc, background: sc + "14", borderRadius: 20, padding: "2px 8px" }}>{u.status}</span></Td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: u.error ? A.red : A.muted, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.error || (u.result ? JSON.stringify(u.result) : "")}</td>
                </tr>
              );
            })}</tbody>
          </table>
        ))}
      </Card>
    </>
  );
}

// ═══ SECTION 5: SYSTEM ═══
function SystemTab({ rpc }) {
  const [counts, setCounts] = React.useState(null);
  const [stats, setStats] = React.useState(null);
  React.useEffect(() => {
    rpc("get_admin_table_counts").then(setCounts);
    rpc("get_admin_platform_stats").then(setStats);
  }, []); // eslint-disable-line

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16, marginBottom: 8 }}>
        <Card title="Database — row counts">
          {!counts ? <Loading /> : Object.entries(counts).map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 18px", borderTop: "1px solid #F2F4F7", fontSize: 13 }}>
              <span style={{ color: "#374151", fontFamily: "'DM Mono',monospace" }}>{k}</span>
              <span style={{ fontFamily: "'DM Mono',monospace", color: A.muted }}>{Number(v).toLocaleString()}</span>
            </div>
          ))}
        </Card>
        <Card title="Storage & cost">
          {!stats ? <Loading /> : (
            <div style={{ padding: "4px 0" }}>
              {[["Supabase Storage (documents)", `${stats.storage_gb} GB`], ["Documents stored", (stats.total_documents || 0).toLocaleString()], ["Est. AI calls", (stats.ai_calls_estimate || 0).toLocaleString()], ["Est. Anthropic cost / mo", fmtMoney((stats.ai_calls_estimate || 0) * 0.012)]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 18px", borderTop: "1px solid #F2F4F7", fontSize: 13 }}>
                  <span style={{ color: "#374151" }}>{k}</span>
                  <span style={{ fontFamily: "'DM Mono',monospace", color: "#101828", fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* RLS / policy verification (moved here from Settings) */}
      <SecurityView />
    </>
  );
}
