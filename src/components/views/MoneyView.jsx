import React from "react";
import { useERP } from "../ERPContext";
import { fmtMoney } from "../../lib/format";
import { glAccountBalance, openPayablesGL, openReceivablesGL } from "../../lib/reports";
import { moneyTiles, MONEY_PAGE_COPY } from "../../lib/moneyPage";

// ═════════════════════════════════════════════════════════════════════════════
// C636 — MONEY: THE OWNER'S ONE DOOR TO EVERY LIST. The owner's menu went from eighteen rows to
// four (Home · Money · Reports · Ask). Every list that used to have its own row opens from here,
// each tile saying in plain words what it is and how much is in it. The tiles are decided in
// `moneyPage.js` (pure) so the words and figures are tested; this file only draws them.
// ═════════════════════════════════════════════════════════════════════════════
export default function MoneyView() {
  const { invoices, contacts, docLibrary, getAccountByRole, setView, setBooksFilter, setVendorFilter, setChatOpen } = useERP();
  const apCode = getAccountByRole?.("accounts_payable")?.code;
  const arCode = getAccountByRole?.("accounts_receivable")?.code;
  const tiles = moneyTiles({
    owe: apCode ? glAccountBalance(apCode, invoices || []) : 0,
    billsOpen: openPayablesGL(invoices || [], apCode).length,
    owed: arCode ? glAccountBalance(arCode, invoices || []) : 0,
    invoicesOpen: openReceivablesGL(invoices || [], arCode).length,
    invoices, contacts, docs: docLibrary,
  }, { money: fmtMoney });

  const open = (view) => {
    setVendorFilter && setVendorFilter("all");
    if (view === "books") setBooksFilter && setBooksFilter("all");
    setView(view);
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Money</h1>
        <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6 }}>{MONEY_PAGE_COPY.intro}</div>
      </div>
      <div data-money-tiles style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {tiles.map((t) => (
          <button key={t.view} data-money-tile={t.view} onClick={() => open(t.view)}
            style={{ textAlign: "left", background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", fontFamily: "var(--sc-font-ui)" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--sc-gold)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--sc-border)"; }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--sc-text)" }}>{t.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 4, lineHeight: 1.45 }}>{t.what}</div>
            {t.figure && <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10, color: t.attention ? "var(--sc-warning)" : "var(--sc-text)", fontFamily: "'DM Mono', monospace" }}>{t.figure}</div>}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 20, fontSize: 13, color: "var(--sc-text-2)" }}>
        {MONEY_PAGE_COPY.askHint}{" "}
        <button onClick={() => setChatOpen && setChatOpen(true)} style={{ background: "none", border: "none", padding: 0, color: "var(--sc-gold)", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>{MONEY_PAGE_COPY.askButton}</button>
      </div>
    </div>
  );
}
