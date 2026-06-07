import React from "react";
import { useERP } from "../ERPContext";
import { taxEstimate, getTaxDeadlines, deductionBreakdown, FED_RATE } from "../../lib/tax";

export default function TaxView() {
  const { invoices, contacts, currentCompany, setView, showNotification, getAccountByRole, supabase } = useERP();
  const fmt = n => "$" + Math.round(Math.abs(n || 0)).toLocaleString("en-US");
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
      const { error } = await supabase.from("tax_settings").upsert(payload, { onConflict: "company_id,tax_year" });
      if (error) console.warn("[tax_settings] save:", error.message);
      else rowExists.current = true;
    } catch (e) { console.warn("[tax_settings] save failed:", e?.message || e); }
  };
  const estPaid = Number(taxState.estPaid) || 0;
  const filed = taxState.filed || {};
  const workFromHome = !!taxState.workFromHome;

  const est = taxEstimate(invoices, year, estPaid);
  const deadlines = getTaxDeadlines(new Date());
  const deductions = deductionBreakdown(invoices, year, getAccountByRole);
  const totalDeductible = deductions.reduce((s, d) => s + (d.amount || 0), 0);
  const need1099 = (contacts || []).filter(c => c.type === "vendor" && c.is1099 && !c.is_1099_exempt && !c.sent_1099_2025).length;

  const card = { background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 14, padding: "18px 20px" };

  const toggleFiled = key => save({ ...taxState, filed: { ...filed, [key]: !filed[key] } });

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#475467", marginBottom: 8 }}>TAX COMPLIANCE</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Taxes</h1>
        <div style={{ fontSize: 13, color: "#475467", marginTop: 6 }}>Your estimated tax picture, deadlines, and deductions — all from your books.</div>
      </div>

      {/* ── TAX PICTURE ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Your estimated tax picture · {year}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          {[
            ["YTD Net Income", fmt(est.net), est.net >= 0 ? "#101828" : "#D92D20"],
            ["Estimated Federal Tax (25%)", fmt(est.federal), "#101828"],
            ["Self-Employment Tax (15.3%)", fmt(est.seTax), "#101828"],
            ["Total Estimated Liability", fmt(est.total), "#4F46E5"],
            ["Estimated Payments Made", fmt(estPaid), "#039855"],
            ["Still Owed", fmt(est.owed), est.owed > 0 ? "#DC6803" : "#039855"],
          ].map(([k, v, col]) => (
            <div key={k} style={{ background: "#F9FAFB", border: "1px solid #F3F4F6", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: "#475467", marginBottom: 5 }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: col }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "#475467" }}>Estimated payments already made this year:</label>
          <input type="number" defaultValue={estPaid || ""} placeholder="0" onBlur={e => save({ ...taxState, estPaid: parseFloat(e.target.value) || 0 })}
            style={{ width: 140, background: "#F3F4F6", border: "1px solid #D0D5DD", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "#101828", outline: "none" }} />
          <span style={{ fontSize: 11, color: "#98A2B3" }}>Updates "Still Owed" above.</span>
        </div>
        <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 10 }}>This is an estimate. Consult your tax advisor for exact amounts.</div>
      </div>

      {/* ── DEADLINE TRACKER ── */}
      <div style={{ ...card, marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #F3F4F6", fontSize: 13, fontWeight: 600 }}>Upcoming tax deadlines</div>
        {deadlines.map(d => {
          const isFiled = !!filed[`${d.key}-${d.year}`];
          return (
            <div key={`${d.key}-${d.year}`} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 20px", borderBottom: "1px solid #F3F4F6", opacity: isFiled ? 0.55 : 1 }}>
              <div style={{ width: 6, height: 38, borderRadius: 3, background: isFiled ? "#98A2B3" : d.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, textDecoration: isFiled ? "line-through" : "none" }}>{d.plain}</div>
                <div style={{ fontSize: 12, color: "#475467", marginTop: 2 }}>
                  {d.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  {d.est && est.total > 0 && <span> · est. {fmt(est.quarterly)}</span>}
                  {" · "}<a href={d.url} target="_blank" rel="noreferrer" style={{ color: "#4F46E5" }}>{d.form} ↗</a>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isFiled ? "#98A2B3" : d.color }}>{isFiled ? "Done" : d.days === 0 ? "Due today" : `${d.days} days`}</div>
              </div>
              <button onClick={() => toggleFiled(`${d.key}-${d.year}`)} title="Mark as filed/paid"
                style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: isFiled ? "#ECFDF5" : "#F3F4F6", border: `1px solid ${isFiled ? "#03985544" : "#D0D5DD"}`, color: isFiled ? "#039855" : "#475467" }}>
                {isFiled ? "✓ Filed" : "Mark filed"}
              </button>
              <button onClick={() => showNotification(`We'll keep "${d.plain}" front and center until ${d.date.toLocaleDateString()}.`)}
                style={{ flexShrink: 0, padding: "6px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "transparent", border: "1px solid #D0D5DD", color: "#475467" }}>
                Remind me
              </button>
            </div>
          );
        })}
      </div>

      {/* ── DEDUCTION TRACKER ── */}
      <div style={{ ...card, marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Deductions tracker · {year}</div>
          <div style={{ fontSize: 12, color: "#475467" }}>Est. tax savings ≈ <span style={{ color: "#039855", fontWeight: 600 }}>{fmt(totalDeductible * FED_RATE)}</span></div>
        </div>
        {deductions.map(d => (
          <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid #F3F4F6" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{d.label}</div>
              <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 2 }}>{d.hint}</div>
            </div>
            {d.ask && d.key === "homeoffice" ? (
              <button onClick={() => { save({ ...taxState, workFromHome: !workFromHome }); showNotification(!workFromHome ? "Noted — ask your advisor about the home-office deduction." : "Home-office flag removed."); }}
                style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: workFromHome ? "#EEF2FF" : "#F3F4F6", border: `1px solid ${workFromHome ? "#4F46E544" : "#D0D5DD"}`, color: workFromHome ? "#4F46E5" : "#475467" }}>
                {workFromHome ? "✓ I work from home" : "Do you work from home?"}
              </button>
            ) : d.ask ? (
              <span style={{ fontSize: 11, color: "#98A2B3", fontStyle: "italic" }}>Tag to track</span>
            ) : (
              <>
                <div style={{ textAlign: "right", minWidth: 110 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: "#101828" }}>{fmt(d.amount)}</div>
                  <div style={{ fontSize: 11, color: "#039855" }}>~{fmt(d.amount * FED_RATE)} saved</div>
                </div>
                <span style={{ fontSize: 11, color: d.categorized ? "#039855" : "#98A2B3", flexShrink: 0, width: 84, textAlign: "right" }}>{d.categorized ? "Categorized" : "None yet"}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── 1099 INTEGRATION ── */}
      <div style={{ ...card, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>1099 contractors</div>
          <div style={{ fontSize: 12, color: need1099 > 0 ? "#DC6803" : "#475467", marginTop: 3 }}>
            {need1099 > 0 ? `${need1099} vendor${need1099 !== 1 ? "s" : ""} need 1099s this year` : "No vendors currently flagged for 1099s"}
          </div>
        </div>
        <button onClick={() => setView("tax1099")} style={{ padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "#EEF2FF", border: "1px solid #4F46E533", color: "#4F46E5", cursor: "pointer" }}>Open 1099 tracker →</button>
      </div>

      {/* ── DISCLAIMERS ── */}
      <div style={{ background: "#FFFBEB", border: "1px solid #DC680333", borderRadius: 14, padding: "16px 20px" }}>
        <div style={{ fontSize: 12, color: "#92400E", lineHeight: 1.6 }}>
          Tax estimates are for planning purposes only and are based on general federal tax rates. State taxes, deductions, credits, and your specific tax situation may significantly affect your actual liability. Always consult a qualified tax professional before filing.
        </div>
        <div style={{ fontSize: 12, color: "#4F46E5", lineHeight: 1.6, marginTop: 10, fontWeight: 500 }}>
          Questions? Your CFAI advisor reviews your books monthly and can provide personalized guidance.
        </div>
      </div>
    </div>
  );
}
