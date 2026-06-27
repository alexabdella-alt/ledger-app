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
const pctColor = (p, goodUp = true) => (p == null || p === 0 ? "var(--sc-text-mut)" : (p > 0) === goodUp ? "var(--sc-success)" : "var(--sc-error)");

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
        <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginBottom: 16 }}>A permanent archive of your month-end financials — generated automatically on the 1st of each month.</div>
        {list === null && <div style={{ color: "var(--sc-text-mut)", fontSize: 14 }}>Loading…</div>}
        {list && list.length === 0 && (
          <div style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: 32, textAlign: "center", color: "var(--sc-text-mut)" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗓️</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--sc-text)", marginBottom: 4 }}>No monthly reports yet</div>
            <div style={{ fontSize: 13 }}>Your first summary generates automatically once a full month of activity has closed.</div>
          </div>
        )}
        {list && list.length > 0 && (
          <div style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, overflow: "clip" }}>
            {list.map((r, i) => {
              const d = r.data || {};
              const net = d.pl?.net_income?.current ?? 0;
              return (
                <div key={r.id} onClick={() => setOpen(r)} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", borderTop: i ? "1px solid var(--sc-surface-2)" : "none", cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--sc-bg)")} onMouseLeave={e => (e.currentTarget.style.background = "var(--sc-surface)")}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--sc-text)" }}>{d.label || formatPeriod(r.period)}</div>
                    <div style={{ fontSize: 12, color: "var(--sc-text-mut)", marginTop: 2 }}>Generated {new Date(r.generated_at).toLocaleDateString()} · {d.transaction_count ?? 0} transactions</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--sc-text-mut)" }}>Revenue</div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono',monospace" }}>{money(d.pl?.revenue?.current)}</div>
                  </div>
                  <div style={{ textAlign: "right", width: 120 }}>
                    <div style={{ fontSize: 11, color: "var(--sc-text-mut)" }}>Net income</div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono',monospace", color: net >= 0 ? "var(--sc-success)" : "var(--sc-error)" }}>{money(net, true)}</div>
                  </div>
                  <span style={{ color: "var(--sc-text-mut)", fontSize: 18 }}>›</span>
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
    const row = (name, c, p, ch, pc, bold) => `<tr style="${bold ? "font-weight:600;border-top:2px solid var(--sc-text);" : ""}"><td style="padding:6px 0;">${esc(name)}</td><td style="text-align:right;">${money(c)}</td><td style="text-align:right;color:var(--sc-text-mut);">${money(p)}</td><td style="text-align:right;">${money(ch, true)}</td><td style="text-align:right;color:var(--sc-text-mut);">${pc == null ? "—" : pc + "%"}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(label)} — Financial Summary</title>
      <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:var(--sc-text);max-width:760px;margin:32px auto;padding:0 24px;line-height:1.5;}
      h1{font-size:24px;margin:0 0 4px;} h2{font-size:15px;border-bottom:1px solid var(--sc-border);padding-bottom:6px;margin:28px 0 10px;}
      table{width:100%;border-collapse:collapse;font-size:13px;} td,th{padding:4px 0;} .sub{color:var(--sc-text-mut);font-size:12px;}
      .summary{background:var(--sc-bg);border:1px solid var(--sc-border);border-radius:10px;padding:14px 16px;font-size:13.5px;margin:14px 0;}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;} .stat{border:1px solid var(--sc-border);border-radius:8px;padding:10px 12px;}
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
      <button onclick="window.print()" style="margin-top:28px;padding:8px 18px;border-radius:8px;border:none;background:var(--sc-gold);color:var(--sc-surface);font-size:13px;cursor:pointer;">Print / Save as PDF</button>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const card = { background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: 24, marginBottom: 16 };
  const sectionTitle = { fontSize: 13, fontWeight: 700, color: "var(--sc-text)", marginBottom: 12, letterSpacing: 0.2 };
  const stat = (label, val, sub, color) => (
    <div style={{ background: "var(--sc-bg)", border: "1px solid var(--sc-border)", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--sc-text-2)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: color || "var(--sc-text)" }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const plRow = (name, line, indent, bold, goodUp = true) => (
    <tr style={{ borderTop: bold ? "2px solid var(--sc-border)" : "1px solid var(--sc-surface-2)", fontWeight: bold ? 700 : 400 }}>
      <td style={{ padding: "9px 12px", paddingLeft: indent ? 28 : 12 }}>{name}</td>
      <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono',monospace" }}>{money(line.current)}</td>
      <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono',monospace", color: "var(--sc-text-mut)" }}>{money(line.prior)}</td>
      <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono',monospace", color: pctColor(line.changePct, goodUp) }}>{pct(line.changePct)}</td>
    </tr>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <button onClick={() => setOpen(null)} style={{ background: "transparent", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 14px", fontSize: 13, color: "var(--sc-text-2)", cursor: "pointer" }}>← All reports</button>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{label}</h2>
        <div style={{ flex: 1 }} />
        <button onClick={downloadPL} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 14px", fontSize: 13, color: "var(--sc-text-2)", cursor: "pointer", fontWeight: 600 }}>↓ Download CSV</button>
        <button onClick={printReport} style={{ background: "var(--sc-gold)", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, color: "var(--sc-on-accent)", cursor: "pointer", fontWeight: 600 }}>Print / PDF</button>
      </div>

      {/* Executive summary */}
      <div style={{ ...card, background: "linear-gradient(135deg,var(--sc-gold-soft),#FAF5FF)", border: "1px solid var(--sc-gold-soft)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sc-gold)", letterSpacing: 1, marginBottom: 8 }}>EXECUTIVE SUMMARY</div>
        <div style={{ fontSize: 15, lineHeight: 1.6, color: "#1E1B4B" }}>{d.summary}</div>
      </div>

      {/* P&L with MoM */}
      <div style={card}>
        <div style={sectionTitle}>Profit &amp; Loss</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr style={{ color: "var(--sc-text-mut)", fontSize: 11 }}>
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
          {stat("Runway", cash.runway_months == null ? "—" : `${cash.runway_months} mo`, cash.runway_months != null && cash.runway_months < 6 ? "watch cash" : null, cash.runway_months != null && cash.runway_months < 6 ? "var(--sc-warning)" : null)}
          {stat("Receivables", money(ar.total), `${money(ar.overdue)} overdue`, ar.overdue > 0 ? "var(--sc-warning)" : null)}
          {stat("Payables", money(ap.total), `${money(ap.overdue)} overdue`)}
        </div>
      </div>

      {/* KPIs */}
      {Array.isArray(d.kpis) && d.kpis.length > 0 && (
        <div style={card}>
          <div style={sectionTitle}>Key Metrics</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            {d.kpis.map(k => (
              <div key={k.key} style={{ border: "1px solid var(--sc-border)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11.5, color: "var(--sc-text-2)", marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: k.status === "good" ? "var(--sc-success)" : k.status === "bad" ? "var(--sc-error)" : k.status === "warn" ? "var(--sc-warning)" : "var(--sc-text)" }}>{k.display}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top vendors + health */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={sectionTitle}>Top Vendors by Spend</div>
          {(d.top_vendors || []).length === 0 && <div style={{ fontSize: 13, color: "var(--sc-text-mut)" }}>No vendor spend this month.</div>}
          {(d.top_vendors || []).map((v, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: i ? "1px solid var(--sc-surface-2)" : "none", fontSize: 13.5 }}>
              <span>{v.vendor}</span><span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{money(v.total)}</span>
            </div>
          ))}
        </div>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={sectionTitle}>Financial Health</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: (d.health?.score ?? 0) >= 80 ? "var(--sc-success)" : (d.health?.score ?? 0) >= 60 ? "var(--sc-warning)" : "var(--sc-error)" }}>{d.health?.score ?? "—"}</span>
            <span style={{ fontSize: 14, color: "var(--sc-text-mut)" }}>/100 · grade {d.health?.grade || "—"} · {d.health?.tier || ""}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 8, lineHeight: 1.5 }}>{d.health?.summary}</div>
        </div>
      </div>

      {/* Anomalies active during the month */}
      {Array.isArray(d.anomalies) && d.anomalies.length > 0 && (
        <div style={{ ...card, marginTop: 16, borderColor: "#FEDF89", background: "#FFFCF5" }}>
          <div style={sectionTitle}>Flags During the Month</div>
          {d.anomalies.map((a, i) => (
            <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--sc-warning-soft)" : "none" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: a.severity === "high" ? "var(--sc-error)" : "var(--sc-warning)" }}>{a.title}</div>
              {a.description && <div style={{ fontSize: 12.5, color: "var(--sc-text-mut)", marginTop: 2 }}>{a.description}</div>}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <button onClick={() => setView("books")} style={{ background: "transparent", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "var(--sc-text-2)", cursor: "pointer" }}>Open the underlying transactions →</button>
      </div>
    </div>
  );
}
