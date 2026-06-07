import React from "react";
import { useERP } from "../ERPContext";
import { taxEstimate, getTaxDeadlines, deductionBreakdown, FED_RATE } from "../../lib/tax";

export default function TaxView() {
  const { invoices, contacts, currentCompany, setView, showNotification, getAccountByRole } = useERP();
  const fmt = n => "$" + Math.round(Math.abs(n || 0)).toLocaleString("en-US");
  const year = new Date().getFullYear();
  const lsKey = `cfai_tax_${currentCompany?.id || "x"}`;

  const [taxState, setTaxState] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(lsKey)) || {}; } catch { return {}; }
  });
  const save = next => { setTaxState(next); try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {} };
  const estPaid = Number(taxState.estPaid) || 0;
  const filed = taxState.filed || {};
  const workFromHome = !!taxState.workFromHome;

  const est = taxEstimate(invoices, year, estPaid);
  const deadlines = getTaxDeadlines(new Date());
  const deductions = deductionBreakdown(invoices, year, getAccountByRole);
  const totalDeductible = deductions.reduce((s, d) => s + (d.amount || 0), 0);
  const need1099 = (contacts || []).filter(c => c.type === "vendor" && c.is1099 && !c.is_1099_exempt && !c.sent_1099_2025).length;

  const card = { background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" };

  const toggleFiled = key => save({ ...taxState, filed: { ...filed, [key]: !filed[key] } });

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#6B7280", marginBottom: 8 }}>TAX COMPLIANCE</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Taxes</h1>
        <div style={{ fontSize: 13, color: "#6B7280", marginTop: 6 }}>Your estimated tax picture, deadlines, and deductions — all from your books.</div>
      </div>

      {/* ── TAX PICTURE ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Your estimated tax picture · {year}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          {[
            ["YTD Net Income", fmt(est.net), est.net >= 0 ? "#111827" : "#DC2626"],
            ["Estimated Federal Tax (25%)", fmt(est.federal), "#111827"],
            ["Self-Employment Tax (15.3%)", fmt(est.seTax), "#111827"],
            ["Total Estimated Liability", fmt(est.total), "#4F46E5"],
            ["Estimated Payments Made", fmt(estPaid), "#059669"],
            ["Still Owed", fmt(est.owed), est.owed > 0 ? "#D97706" : "#059669"],
          ].map(([k, v, col]) => (
            <div key={k} style={{ background: "#F9FAFB", border: "1px solid #F3F4F6", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 5 }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: col }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "#6B7280" }}>Estimated payments already made this year:</label>
          <input type="number" defaultValue={estPaid || ""} placeholder="0" onBlur={e => save({ ...taxState, estPaid: parseFloat(e.target.value) || 0 })}
            style={{ width: 140, background: "#F3F4F6", border: "1px solid #D1D5DB", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "#111827", outline: "none" }} />
          <span style={{ fontSize: 11, color: "#9CA3AF" }}>Updates "Still Owed" above.</span>
        </div>
        <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 10 }}>This is an estimate. Consult your tax advisor for exact amounts.</div>
      </div>

      {/* ── DEADLINE TRACKER ── */}
      <div style={{ ...card, marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #F3F4F6", fontSize: 13, fontWeight: 600 }}>Upcoming tax deadlines</div>
        {deadlines.map(d => {
          const isFiled = !!filed[`${d.key}-${d.year}`];
          return (
            <div key={`${d.key}-${d.year}`} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 20px", borderBottom: "1px solid #F3F4F6", opacity: isFiled ? 0.55 : 1 }}>
              <div style={{ width: 6, height: 38, borderRadius: 3, background: isFiled ? "#9CA3AF" : d.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, textDecoration: isFiled ? "line-through" : "none" }}>{d.plain}</div>
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                  {d.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  {d.est && est.total > 0 && <span> · est. {fmt(est.quarterly)}</span>}
                  {" · "}<a href={d.url} target="_blank" rel="noreferrer" style={{ color: "#4F46E5" }}>{d.form} ↗</a>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isFiled ? "#9CA3AF" : d.color }}>{isFiled ? "Done" : d.days === 0 ? "Due today" : `${d.days} days`}</div>
              </div>
              <button onClick={() => toggleFiled(`${d.key}-${d.year}`)} title="Mark as filed/paid"
                style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: isFiled ? "#ECFDF5" : "#F3F4F6", border: `1px solid ${isFiled ? "#05966944" : "#D1D5DB"}`, color: isFiled ? "#059669" : "#6B7280" }}>
                {isFiled ? "✓ Filed" : "Mark filed"}
              </button>
              <button onClick={() => showNotification(`We'll keep "${d.plain}" front and center until ${d.date.toLocaleDateString()}.`)}
                style={{ flexShrink: 0, padding: "6px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "transparent", border: "1px solid #D1D5DB", color: "#6B7280" }}>
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
          <div style={{ fontSize: 12, color: "#6B7280" }}>Est. tax savings ≈ <span style={{ color: "#059669", fontWeight: 600 }}>{fmt(totalDeductible * FED_RATE)}</span></div>
        </div>
        {deductions.map(d => (
          <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid #F3F4F6" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{d.label}</div>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{d.hint}</div>
            </div>
            {d.ask && d.key === "homeoffice" ? (
              <button onClick={() => { save({ ...taxState, workFromHome: !workFromHome }); showNotification(!workFromHome ? "Noted — ask your advisor about the home-office deduction." : "Home-office flag removed."); }}
                style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: workFromHome ? "#EEF2FF" : "#F3F4F6", border: `1px solid ${workFromHome ? "#4F46E544" : "#D1D5DB"}`, color: workFromHome ? "#4F46E5" : "#6B7280" }}>
                {workFromHome ? "✓ I work from home" : "Do you work from home?"}
              </button>
            ) : d.ask ? (
              <span style={{ fontSize: 11, color: "#9CA3AF", fontStyle: "italic" }}>Tag to track</span>
            ) : (
              <>
                <div style={{ textAlign: "right", minWidth: 110 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: "#111827" }}>{fmt(d.amount)}</div>
                  <div style={{ fontSize: 11, color: "#059669" }}>~{fmt(d.amount * FED_RATE)} saved</div>
                </div>
                <span style={{ fontSize: 11, color: d.categorized ? "#059669" : "#9CA3AF", flexShrink: 0, width: 84, textAlign: "right" }}>{d.categorized ? "Categorized" : "None yet"}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── 1099 INTEGRATION ── */}
      <div style={{ ...card, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>1099 contractors</div>
          <div style={{ fontSize: 12, color: need1099 > 0 ? "#D97706" : "#6B7280", marginTop: 3 }}>
            {need1099 > 0 ? `${need1099} vendor${need1099 !== 1 ? "s" : ""} need 1099s this year` : "No vendors currently flagged for 1099s"}
          </div>
        </div>
        <button onClick={() => setView("tax1099")} style={{ padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "#EEF2FF", border: "1px solid #4F46E533", color: "#4F46E5", cursor: "pointer" }}>Open 1099 tracker →</button>
      </div>

      {/* ── DISCLAIMERS ── */}
      <div style={{ background: "#FFFBEB", border: "1px solid #D9770633", borderRadius: 14, padding: "16px 20px" }}>
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
