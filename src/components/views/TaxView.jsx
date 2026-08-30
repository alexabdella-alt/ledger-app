import React from "react";
import { fmtMoney } from "../../lib/format";
import { useERP } from "../ERPContext";
import { taxEstimate, getTaxDeadlines, deductionBreakdown, FED_RATE } from "../../lib/tax";
import { plan1099, plan1099Copy } from "../../lib/form1099";

export default function TaxView() {
  const { invoices, contacts, currentCompany, setView, showNotification, getAccountByRole, CHART_OF_ACCOUNTS, supabase } = useERP();
  const fmt = fmtMoney;
  const year = new Date().getFullYear();
  const lsKey = `cfai_tax_${currentCompany?.id || "x"}`;

  // Tax compliance state lives in Supabase (tax_settings). Falls back to the
  // legacy localStorage blob (and migrates it) or defaults until a row exists.
  const [taxState, setTaxState] = React.useState({ estPaid: 0, filed: {}, workFromHome: false });
  const rowExists = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentCompany?.id) return;
      let loaded = null;
      try {
        const { data, error } = await supabase.from("tax_settings")
          .select("*").eq("company_id", currentCompany.id).eq("tax_year", year).maybeSingle();
        if (!error && data) {
          rowExists.current = true;
          loaded = {
            estPaid: Number(data.estimated_payments_made) || 0,
            workFromHome: !!data.work_from_home,
            filed: (data.filed_deadlines && typeof data.filed_deadlines === "object" && !Array.isArray(data.filed_deadlines)) ? data.filed_deadlines : {},
          };
        }
      } catch { /* table may not exist yet — fall through */ }
      if (!loaded) {
        try { const ls = JSON.parse(localStorage.getItem(lsKey)); if (ls) loaded = { estPaid: Number(ls.estPaid) || 0, filed: ls.filed || {}, workFromHome: !!ls.workFromHome }; } catch {}
      }
      if (!cancelled && loaded) setTaxState(loaded);
    })();
    return () => { cancelled = true; };
  }, [currentCompany?.id, year]);

  const save = async (next) => {
    setTaxState(next);
    try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {} // keep a local mirror as a backup
    try {
      const payload = {
        company_id: currentCompany.id, tax_year: year,
        estimated_payments_made: Number(next.estPaid) || 0,
        work_from_home: !!next.workFromHome,
        filed_deadlines: next.filed || {},
      };
      // ★★ THIS USED TO FAIL TO A `console.warn` AND NOTHING ELSE. What is being saved here
      // is the figures a person typed — estimated payments made, which deadlines are filed —
      // so a silent failure means they enter their tax position, see no complaint, and find
      // it gone next time they open the page. **A silent failure of the user's own typing is
      // the worst kind**: they have no reason to suspect it and no way to notice.
      const { data, error } = await supabase.from("tax_settings")
        .upsert(payload, { onConflict: "company_id,tax_year" })
        .select("company_id");
      if (error || !data || !data.length) {
        console.error("[tax_settings] save failed:", error?.message || "no rows written");
        showNotification && showNotification("Couldn't save your tax figures — they haven't been kept. Please try again.", "error");
        return;
      }
      rowExists.current = true;
    } catch (e) {
      console.error("[tax_settings] save failed:", e?.message || e);
      showNotification && showNotification("Couldn't save your tax figures — they haven't been kept. Please try again.", "error");
    }
  };
  const estPaid = Number(taxState.estPaid) || 0;
  const filed = taxState.filed || {};
  const workFromHome = !!taxState.workFromHome;

  const est = taxEstimate(invoices, year, estPaid);
  const deadlines = getTaxDeadlines(new Date());
  const deductions = deductionBreakdown(invoices, year, getAccountByRole);
  const totalDeductible = deductions.reduce((s, d) => s + (d.amount || 0), 0);
  // ── 1099s ARE WORKED OUT, NOT COUNTED OFF A FLAG ─────────────────────────────
  // This used to count `is1099` — a badge that was effectively defaulted on, so on one
  // company nearly every supplier carried it: food, equipment, a utility, none of them
  // reportable. A 1099 is filed with the IRS under the accountant's name, and that count is
  // what tells them how much work there is.
  //
  // ★ THE VENDOR'S PAYMENTS COME FROM THE LEDGER, matched on the same grouping key the
  // vendor list uses (O111), so a supplier known by two names is one supplier here too.
  const roleOfCode = React.useCallback(
    (code) => (CHART_OF_ACCOUNTS || []).find(a => String(a.code) === String(code))?.system_role || null,
    [CHART_OF_ACCOUNTS]);
  const plan = React.useMemo(() => {
    const yearRows = (invoices || []).filter(i => String(i?.date || "").startsWith(String(year)));
    const byName = new Map();
    for (const r of yearRows) {
      const k = String(r.vendor_key || r.vendor || "").toLowerCase();
      if (!k) continue;
      (byName.get(k) || byName.set(k, []).get(k)).push(r);
    }
    return plan1099({
      contacts,
      vendorRowsFor: (c) => byName.get(String(c.name || "").toLowerCase()) || [],
      roleOfCode,
    });
  }, [invoices, contacts, year, roleOfCode]);
  const need1099 = plan.outstanding;

  const card = { background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: "18px 20px" };

  const toggleFiled = key => save({ ...taxState, filed: { ...filed, [key]: !filed[key] } });

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "var(--sc-text-2)", marginBottom: 8 }}>TAX COMPLIANCE</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Taxes</h1>
        <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6 }}>Your estimated tax picture, deadlines, and deductions — all from your books.</div>
      </div>

      {/* ── TAX PICTURE ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Your estimated tax picture · {year}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          {[
            ["YTD Net Income", fmt(est.net), est.net >= 0 ? "var(--sc-text)" : "var(--sc-error)"],
            ["Estimated Federal Tax (25%)", fmt(est.federal), "var(--sc-text)"],
            ["Self-Employment Tax (15.3%)", fmt(est.seTax), "var(--sc-text)"],
            ["Total Estimated Liability", fmt(est.total), "var(--sc-gold)"],
            ["Estimated Payments Made", fmt(estPaid), "var(--sc-success)"],
            ["Still Owed", fmt(est.owed), est.owed > 0 ? "var(--sc-warning)" : "var(--sc-success)"],
          ].map(([k, v, col]) => (
            <div key={k} style={{ background: "var(--sc-bg)", border: "1px solid var(--sc-surface-2)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--sc-text-2)", marginBottom: 5 }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: col }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--sc-text-2)" }}>Estimated payments already made this year:</label>
          <input type="number" defaultValue={estPaid || ""} placeholder="0" onBlur={e => save({ ...taxState, estPaid: parseFloat(e.target.value) || 0 })}
            style={{ width: 140, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--sc-text)", outline: "none" }} />
          <span style={{ fontSize: 11, color: "var(--sc-text-mut)" }}>Updates "Still Owed" above.</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 10 }}>This is an estimate. Consult your tax advisor for exact amounts.</div>
      </div>

      {/* ── DEADLINE TRACKER ── */}
      <div style={{ ...card, marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--sc-surface-2)", fontSize: 13, fontWeight: 600 }}>Upcoming tax deadlines</div>
        {deadlines.map(d => {
          const isFiled = !!filed[`${d.key}-${d.year}`];
          return (
            <div key={`${d.key}-${d.year}`} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 20px", borderBottom: "1px solid var(--sc-surface-2)", opacity: isFiled ? 0.55 : 1 }}>
              <div style={{ width: 6, height: 38, borderRadius: 3, background: isFiled ? "var(--sc-text-mut)" : d.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, textDecoration: isFiled ? "line-through" : "none" }}>{d.plain}</div>
                <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 2 }}>
                  {d.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  {d.est && est.total > 0 && <span> · est. {fmt(est.quarterly)}</span>}
                  {" · "}<a href={d.url} target="_blank" rel="noreferrer" style={{ color: "var(--sc-gold)" }}>{d.form} ↗</a>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isFiled ? "var(--sc-text-mut)" : d.color }}>{isFiled ? "Done" : d.days === 0 ? "Due today" : `${d.days} days`}</div>
              </div>
              <button onClick={() => toggleFiled(`${d.key}-${d.year}`)} title="Mark as filed/paid"
                style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: isFiled ? "var(--sc-success-soft)" : "var(--sc-surface-2)", border: `1px solid ${isFiled ? "var(--sc-success-soft)" : "var(--sc-border-2)"}`, color: isFiled ? "var(--sc-success)" : "var(--sc-text-2)" }}>
                {isFiled ? "✓ Filed" : "Mark filed"}
              </button>
              <button onClick={() => showNotification(`We'll keep "${d.plain}" front and center until ${d.date.toLocaleDateString()}.`)}
                style={{ flexShrink: 0, padding: "6px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)" }}>
                Remind me
              </button>
            </div>
          );
        })}
      </div>

      {/* ── DEDUCTION TRACKER ── */}
      <div style={{ ...card, marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--sc-surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Deductions tracker · {year}</div>
          <div style={{ fontSize: 12, color: "var(--sc-text-2)" }}>Est. tax savings ≈ <span style={{ color: "var(--sc-success)", fontWeight: 600 }}>{fmt(totalDeductible * FED_RATE)}</span></div>
        </div>
        {deductions.map(d => (
          <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--sc-surface-2)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{d.label}</div>
              <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 2 }}>{d.hint}</div>
            </div>
            {d.ask && d.key === "homeoffice" ? (
              <button onClick={() => { save({ ...taxState, workFromHome: !workFromHome }); showNotification(!workFromHome ? "Noted — ask your advisor about the home-office deduction." : "Home-office flag removed."); }}
                style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: workFromHome ? "var(--sc-gold-soft)" : "var(--sc-surface-2)", border: `1px solid ${workFromHome ? "var(--sc-gold-soft)" : "var(--sc-border-2)"}`, color: workFromHome ? "var(--sc-gold)" : "var(--sc-text-2)" }}>
                {workFromHome ? "✓ I work from home" : "Do you work from home?"}
              </button>
            ) : d.ask ? (
              <span style={{ fontSize: 11, color: "var(--sc-text-mut)", fontStyle: "italic" }}>Tag to track</span>
            ) : (
              <>
                <div style={{ textAlign: "right", minWidth: 110 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: "var(--sc-text)" }}>{fmt(d.amount)}</div>
                  <div style={{ fontSize: 11, color: "var(--sc-success)" }}>~{fmt(d.amount * FED_RATE)} saved</div>
                </div>
                <span style={{ fontSize: 11, color: d.categorized ? "var(--sc-success)" : "var(--sc-text-mut)", flexShrink: 0, width: 84, textAlign: "right" }}>{d.categorized ? "Categorized" : "None yet"}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── 1099 INTEGRATION ── */}
      <div style={{ ...card, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>1099 contractors</div>
          <div style={{ fontSize: 12, color: need1099 > 0 ? "var(--sc-warning)" : "var(--sc-text-2)", marginTop: 3 }}>
            {plan1099Copy(plan)}
          </div>
        </div>
        <button onClick={() => setView("tax1099")} style={{ padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold-soft)", color: "var(--sc-gold)", cursor: "pointer" }}>Open 1099 tracker →</button>
      </div>

      {/* ── DISCLAIMERS ── */}
      <div style={{ background: "var(--sc-warning-soft)", border: "1px solid var(--sc-warning-soft)", borderRadius: 14, padding: "16px 20px" }}>
        <div style={{ fontSize: 12, color: "var(--sc-warning)", lineHeight: 1.6 }}>
          Tax estimates are for planning purposes only and are based on general federal tax rates. State taxes, deductions, credits, and your specific tax situation may significantly affect your actual liability. Always consult a qualified tax professional before filing.
        </div>
        <div style={{ fontSize: 12, color: "var(--sc-gold)", lineHeight: 1.6, marginTop: 10, fontWeight: 500 }}>
          Questions? Your CFAI advisor reviews your books monthly and can provide personalized guidance.
        </div>
      </div>
    </div>
  );
}
