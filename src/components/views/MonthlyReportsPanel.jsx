import React from "react";
import { useERP } from "../ERPContext";
import { formatPeriod } from "../../lib/reports";
import { downloadCSV } from "../../lib/insights";

const money = (n, sign) => {
  const v = Number(n) || 0;
  const s = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? (sign ? "−" + s : "(" + s + ")") : s;
};
const pct = (p) => (p == null ? "—" : `${p > 0 ? "+" : ""}${p}%`);
const pctColor = (p, goodUp = true) => (p == null || p === 0 ? "#667085" : (p > 0) === goodUp ? "#039855" : "#D92D20");

export default function MonthlyReportsPanel() {
  const { supabase, currentCompany, setView } = useERP();
  const [list, setList] = React.useState(null);   // null = loading
  const [open, setOpen] = React.useState(null);    // the selected report row

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!currentCompany?.id) return;
      try {
        const { data } = await supabase.from("monthly_reports").select("*").eq("company_id", currentCompany.id).order("period", { ascending: false });
        if (alive) setList(Array.isArray(data) ? data : []);
      } catch { if (alive) setList([]); }
    })();
    return () => { alive = false; };
  }, [currentCompany?.id, supabase]);

  // ── List ──
  if (!open) {
    return (
      <div>
        <div style={{ fontSize: 13, color: "#475467", marginBottom: 16 }}>A permanent archive of your month-end financials — generated automatically on the 1st of each month.</div>
        {list === null && <div style={{ color: "#667085", fontSize: 14 }}>Loading…</div>}
        {list && list.length === 0 && (
          <div style={{ background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 14, padding: 32, textAlign: "center", color: "#667085" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗓️</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#101828", marginBottom: 4 }}>No monthly reports yet</div>
            <div style={{ fontSize: 13 }}>Your first summary generates automatically once a full month of activity has closed.</div>
          </div>
        )}
        {list && list.length > 0 && (
          <div style={{ background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 14, overflow: "clip" }}>
            {list.map((r, i) => {
              const d = r.data || {};
              const net = d.pl?.net_income?.current ?? 0;
              return (
                <div key={r.id} onClick={() => setOpen(r)} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", borderTop: i ? "1px solid #F3F4F6" : "none", cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#F9FAFB")} onMouseLeave={e => (e.currentTarget.style.background = "#FFFFFF")}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#101828" }}>{d.label || formatPeriod(r.period)}</div>
                    <div style={{ fontSize: 12, color: "#98A2B3", marginTop: 2 }}>Generated {new Date(r.generated_at).toLocaleDateString()} · {d.transaction_count ?? 0} transactions</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#98A2B3" }}>Revenue</div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono',monospace" }}>{money(d.pl?.revenue?.current)}</div>
                  </div>
                  <div style={{ textAlign: "right", width: 120 }}>
                    <div style={{ fontSize: 11, color: "#98A2B3" }}>Net income</div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono',monospace", color: net >= 0 ? "#039855" : "#D92D20" }}>{money(net, true)}</div>
                  </div>
                  <span style={{ color: "#98A2B3", fontSize: 18 }}>›</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Single report view ──
  const d = open.data || {};
  const label = d.label || formatPeriod(open.period);
  const pl = d.pl || {}, cash = d.cash || {}, ar = d.receivables || {}, ap = d.payables || {};

  const downloadPL = () => {
    const rows = [
      ["Revenue", pl.revenue?.current ?? 0, pl.revenue?.prior ?? 0, pl.revenue?.change ?? 0, pl.revenue?.changePct ?? ""],
      ...(pl.expense_lines || []).map(l => [l.category, -(l.current || 0), -(l.prior || 0), -(l.change || 0), l.changePct ?? ""]),
      ["Total Expenses", -(pl.expenses_total?.current ?? 0), -(pl.expenses_total?.prior ?? 0), -(pl.expenses_total?.change ?? 0), pl.expenses_total?.changePct ?? ""],
      ["Net Income", pl.net_income?.current ?? 0, pl.net_income?.prior ?? 0, pl.net_income?.change ?? 0, pl.net_income?.changePct ?? ""],
    ];
    downloadCSV(`monthly-pl-${open.period}.csv`, ["Line", "Current", "Prior Month", "Change ($)", "Change (%)"], rows);
  };

  // Build a clean, print-only HTML doc → the basis for the CPA-reviewed PDF.
  const printReport = () => {
    const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const row = (name, c, p, ch, pc, bold) => `<tr style="${bold ? "font-weight:600;border-top:2px solid #101828;" : ""}"><td style="padding:6px 0;">${esc(name)}</td><td style="text-align:right;">${money(c)}</td><td style="text-align:right;color:#667085;">${money(p)}</td><td style="text-align:right;">${money(ch, true)}</td><td style="text-align:right;color:#667085;">${pc == null ? "—" : pc + "%"}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(label)} — Financial Summary</title>
      <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#101828;max-width:760px;margin:32px auto;padding:0 24px;line-height:1.5;}
      h1{font-size:24px;margin:0 0 4px;} h2{font-size:15px;border-bottom:1px solid #E4E7EC;padding-bottom:6px;margin:28px 0 10px;}
      table{width:100%;border-collapse:collapse;font-size:13px;} td,th{padding:4px 0;} .sub{color:#667085;font-size:12px;}
      .summary{background:#F9FAFB;border:1px solid #EEF0F4;border-radius:10px;padding:14px 16px;font-size:13.5px;margin:14px 0;}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;} .stat{border:1px solid #EEF0F4;border-radius:8px;padding:10px 12px;}
      @media print{button{display:none;}}</style></head><body>
      <h1>${esc(label)} — Financial Summary</h1>
      <div class="sub">${esc(currentCompany?.name || "")} · generated ${new Date(open.generated_at).toLocaleDateString()}</div>
      <div class="summary">${esc(d.summary || "")}</div>
      <h2>Profit &amp; Loss</h2>
      <table><thead><tr class="sub"><th style="text-align:left;">Line</th><th style="text-align:right;">This month</th><th style="text-align:right;">Prior</th><th style="text-align:right;">Change</th><th style="text-align:right;">%</th></tr></thead><tbody>
      ${row("Revenue", pl.revenue?.current, pl.revenue?.prior, pl.revenue?.change, pl.revenue?.changePct)}
      ${(pl.expense_lines || []).map(l => row("  " + l.category, -(l.current || 0), -(l.prior || 0), -(l.change || 0), l.changePct)).join("")}
      ${row("Total Expenses", -(pl.expenses_total?.current || 0), -(pl.expenses_total?.prior || 0), -(pl.expenses_total?.change || 0), pl.expenses_total?.changePct)}
      ${row("Net Income", pl.net_income?.current, pl.net_income?.prior, pl.net_income?.change, pl.net_income?.changePct, true)}
      </tbody></table>
      <h2>Cash &amp; Receivables</h2>
      <div class="grid">
        <div class="stat"><div class="sub">Cash on hand</div><div>${money(cash.cash_on_hand)}</div></div>
        <div class="stat"><div class="sub">Monthly burn</div><div>${money(cash.burn_rate)}</div></div>
        <div class="stat"><div class="sub">Runway</div><div>${cash.runway_months == null ? "—" : cash.runway_months + " mo"}</div></div>
        <div class="stat"><div class="sub">Receivables</div><div>${money(ar.total)} <span class="sub">(${money(ar.overdue)} overdue)</span></div></div>
        <div class="stat"><div class="sub">Payables</div><div>${money(ap.total)} <span class="sub">(${money(ap.overdue)} overdue)</span></div></div>
        <div class="stat"><div class="sub">Health score</div><div>${d.health?.score ?? "—"}/100 (${esc(d.health?.tier || "")})</div></div>
      </div>
      <button onclick="window.print()" style="margin-top:28px;padding:8px 18px;border-radius:8px;border:none;background:#4F46E5;color:#fff;font-size:13px;cursor:pointer;">Print / Save as PDF</button>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const card = { background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 14, padding: 24, marginBottom: 16 };
  const sectionTitle = { fontSize: 13, fontWeight: 700, color: "#101828", marginBottom: 12, letterSpacing: 0.2 };
  const stat = (label, val, sub, color) => (
    <div style={{ background: "#F9FAFB", border: "1px solid #F0F1F4", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "#475467", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: color || "#101828" }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const plRow = (name, line, indent, bold, goodUp = true) => (
    <tr style={{ borderTop: bold ? "2px solid #E4E7EC" : "1px solid #F3F4F6", fontWeight: bold ? 700 : 400 }}>
      <td style={{ padding: "9px 12px", paddingLeft: indent ? 28 : 12 }}>{name}</td>
      <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono',monospace" }}>{money(line.current)}</td>
      <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono',monospace", color: "#98A2B3" }}>{money(line.prior)}</td>
      <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono',monospace", color: pctColor(line.changePct, goodUp) }}>{pct(line.changePct)}</td>
    </tr>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <button onClick={() => setOpen(null)} style={{ background: "transparent", border: "1px solid #D0D5DD", borderRadius: 8, padding: "7px 14px", fontSize: 13, color: "#475467", cursor: "pointer" }}>← All reports</button>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{label}</h2>
        <div style={{ flex: 1 }} />
        <button onClick={downloadPL} style={{ background: "#FFFFFF", border: "1px solid #D0D5DD", borderRadius: 8, padding: "7px 14px", fontSize: 13, color: "#374151", cursor: "pointer", fontWeight: 600 }}>↓ Download CSV</button>
        <button onClick={printReport} style={{ background: "#4F46E5", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, color: "#fff", cursor: "pointer", fontWeight: 600 }}>Print / PDF</button>
      </div>

      {/* Executive summary */}
      <div style={{ ...card, background: "linear-gradient(135deg,#EEF2FF,#FAF5FF)", border: "1px solid #E0E7FF" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#4F46E5", letterSpacing: 1, marginBottom: 8 }}>EXECUTIVE SUMMARY</div>
        <div style={{ fontSize: 15, lineHeight: 1.6, color: "#1E1B4B" }}>{d.summary}</div>
      </div>

      {/* P&L with MoM */}
      <div style={card}>
        <div style={sectionTitle}>Profit &amp; Loss</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr style={{ color: "#98A2B3", fontSize: 11 }}>
            <th style={{ textAlign: "left", padding: "0 12px 8px" }}>LINE</th>
            <th style={{ textAlign: "right", padding: "0 12px 8px" }}>THIS MONTH</th>
            <th style={{ textAlign: "right", padding: "0 12px 8px" }}>PRIOR</th>
            <th style={{ textAlign: "right", padding: "0 12px 8px" }}>MoM</th>
          </tr></thead>
          <tbody>
            {plRow("Revenue", pl.revenue || {}, false, false, true)}
            {(pl.expense_lines || []).map(l => plRow(l.category, l, true, false, false))}
            {plRow("Total Expenses", pl.expenses_total || {}, false, false, false)}
            {plRow("Net Income", pl.net_income || {}, false, true, true)}
          </tbody>
        </table>
      </div>

      {/* Cash & burn + AR/AP */}
      <div style={card}>
        <div style={sectionTitle}>Cash, Burn &amp; Working Capital</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          {stat("Cash on hand", money(cash.cash_on_hand))}
          {stat("Monthly burn", money(cash.burn_rate))}
          {stat("Runway", cash.runway_months == null ? "—" : `${cash.runway_months} mo`, cash.runway_months != null && cash.runway_months < 6 ? "watch cash" : null, cash.runway_months != null && cash.runway_months < 6 ? "#DC6803" : null)}
          {stat("Receivables", money(ar.total), `${money(ar.overdue)} overdue`, ar.overdue > 0 ? "#DC6803" : null)}
          {stat("Payables", money(ap.total), `${money(ap.overdue)} overdue`)}
        </div>
      </div>

      {/* KPIs */}
      {Array.isArray(d.kpis) && d.kpis.length > 0 && (
        <div style={card}>
          <div style={sectionTitle}>Key Metrics</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            {d.kpis.map(k => (
              <div key={k.key} style={{ border: "1px solid #F0F1F4", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11.5, color: "#475467", marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: k.status === "good" ? "#039855" : k.status === "bad" ? "#D92D20" : k.status === "warn" ? "#DC6803" : "#101828" }}>{k.display}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top vendors + health */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={sectionTitle}>Top Vendors by Spend</div>
          {(d.top_vendors || []).length === 0 && <div style={{ fontSize: 13, color: "#98A2B3" }}>No vendor spend this month.</div>}
          {(d.top_vendors || []).map((v, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: i ? "1px solid #F3F4F6" : "none", fontSize: 13.5 }}>
              <span>{v.vendor}</span><span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{money(v.total)}</span>
            </div>
          ))}
        </div>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={sectionTitle}>Financial Health</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: (d.health?.score ?? 0) >= 80 ? "#039855" : (d.health?.score ?? 0) >= 60 ? "#DC6803" : "#D92D20" }}>{d.health?.score ?? "—"}</span>
            <span style={{ fontSize: 14, color: "#667085" }}>/100 · grade {d.health?.grade || "—"} · {d.health?.tier || ""}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "#475467", marginTop: 8, lineHeight: 1.5 }}>{d.health?.summary}</div>
        </div>
      </div>

      {/* Anomalies active during the month */}
      {Array.isArray(d.anomalies) && d.anomalies.length > 0 && (
        <div style={{ ...card, marginTop: 16, borderColor: "#FEDF89", background: "#FFFCF5" }}>
          <div style={sectionTitle}>Flags During the Month</div>
          {d.anomalies.map((a, i) => (
            <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid #FEF0C7" : "none" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: a.severity === "high" ? "#B42318" : "#B54708" }}>{a.title}</div>
              {a.description && <div style={{ fontSize: 12.5, color: "#667085", marginTop: 2 }}>{a.description}</div>}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <button onClick={() => setView("books")} style={{ background: "transparent", border: "1px solid #D0D5DD", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#475467", cursor: "pointer" }}>Open the underlying transactions →</button>
      </div>
    </div>
  );
}
