import React from "react";
import { useERP } from "../ERPContext";
import { fmtMoney } from "../../lib/format";
import { glAccountBalance, openPayablesGL, openReceivablesGL } from "../../lib/reports";
import { moneySummary, moneyLinks, MONEY_PAGE_COPY } from "../../lib/moneyPage";
import BooksView from "./BooksView";

// ═════════════════════════════════════════════════════════════════════════════
// C637 — MONEY IS ONE LIST. The owner's Money page (C636) was a set of tiles that each opened a
// separate screen. Now the page IS the list: everything in the books, searchable, with filters
// for what you owe, what you're owed, income and spending — the Transactions list (its search,
// detail panel, Mark Paid and Collect included), embedded. Two figures above it set the filter;
// customers, vendors and documents sit one click away below. The accountant still has each
// list as its own screen.
// ═════════════════════════════════════════════════════════════════════════════
export default function MoneyView() {
  const { invoices, contacts, docLibrary, getAccountByRole, setView, booksFilter, setBooksFilter, setVendorFilter, setChatOpen, setSendInvoiceDraftState, isViewer } = useERP();
  const apCode = getAccountByRole?.("accounts_payable")?.code;
  const arCode = getAccountByRole?.("accounts_receivable")?.code;
  const summary = moneySummary({
    owe: apCode ? glAccountBalance(apCode, invoices || []) : 0,
    billsOpen: openPayablesGL(invoices || [], apCode).length,
    owed: arCode ? glAccountBalance(arCode, invoices || []) : 0,
    invoicesOpen: openReceivablesGL(invoices || [], arCode).length,
  });
  const links = moneyLinks({ contacts, docs: docLibrary });
  const pick = (filter) => { setVendorFilter && setVendorFilter("all"); setBooksFilter && setBooksFilter(booksFilter === filter ? "all" : filter); };

  return (
    <div>
      <div style={{ marginBottom: 18, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Money</h1>
          <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6 }}>{MONEY_PAGE_COPY.intro}</div>
        </div>
        {isViewer ? <div data-view-only style={{ fontSize: 12, color: "var(--sc-text-2)", maxWidth: 260 }}>You have view-only access — you can see everything here; the owner or an admin records payments and sends invoices.</div> : <button data-money-send-invoice onClick={() => setView("send-invoice")}
          style={{ flexShrink: 0, padding: "10px 18px", borderRadius: 9, background: "var(--sc-gold)", border: "none", color: "var(--sc-on-accent)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Send an invoice
        </button>}
      </div>

      <div data-money-summary style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 18 }}>
        {summary.map((s) => {
          const on = booksFilter === s.filter;
          return (
            <button key={s.filter} data-money-figure={s.filter} onClick={() => pick(s.filter)} aria-pressed={on}
              style={{ textAlign: "left", background: on ? "var(--sc-gold-soft)" : "var(--sc-surface)", border: `1px solid ${on ? "var(--sc-gold)" : "var(--sc-border)"}`, borderRadius: 14, padding: "14px 18px", cursor: "pointer", fontFamily: "var(--sc-font-ui)" }}>
              <div style={{ fontSize: 12, color: "var(--sc-text-2)" }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: s.attention ? "var(--sc-warning)" : "var(--sc-text)", fontFamily: "'DM Mono', monospace" }}>{s.figure}</div>
              <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 2 }}>{s.sub}</div>
            </button>
          );
        })}
      </div>

      <BooksView embedded />

      <div data-money-links style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--sc-text-2)" }}>Also here:</span>
        {links.map((l) => (
          <button key={l.view} data-money-link={l.view} onClick={() => setView(l.view)}
            style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 20, padding: "6px 14px", fontSize: 13, color: "var(--sc-text)", cursor: "pointer" }}>
            {l.label}{l.count ? ` · ${l.count}` : ""}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 14, fontSize: 13, color: "var(--sc-text-2)" }}>
        {MONEY_PAGE_COPY.askHint}{" "}
        <button onClick={() => setChatOpen && setChatOpen(true)} style={{ background: "none", border: "none", padding: 0, color: "var(--sc-gold)", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>{MONEY_PAGE_COPY.askButton}</button>
      </div>
    </div>
  );
}
