import { findContactForName } from "../../lib/contactMatch";
import React from "react";
import { plainWriteError } from "../../lib/plainWriteError";
import { useERP } from "../ERPContext";
import LoadFailedNotice from "../LoadFailedNotice";
import LoadingList from "../LoadingList";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate , fmtMoney, todayLocal, deriveDueDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { buildArInvoiceEntry } from "../../lib/revenueEntries";
import { newInvoiceDraft, emptyInvoiceLine, draftBase , invoiceSendBlockers, invoiceTotalOf, invoiceDueLabel, customerDefaultsFor, INVOICE_TERM_OPTIONS } from "../../lib/invoiceDraft";
import { arInvoiceRows, isDbInvoiceId } from "../../lib/arInvoiceRows";
import { contactDbId } from "../../lib/contactIds";
import { checkedRowUpdate } from "../../lib/checkedWrite";
import { MAIL_DOMAIN } from "../../lib/constants";
import { makeOneInFlight } from "../../lib/oneInFlight";

export default function SendInvoiceView() {
  const { aliasIndex, mailChannel, sendChannelMail, CHART_OF_ACCOUNTS, CONTRACT_TYPES, aiStep, aiSuggestion, allProjects, allVendorNames, apView, applyMatch, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatLoading, chatOpen, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, createOrUpdateContact, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getAccountByRole, assertBookable, markBillPaid, persistMultiLineEntry, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, matchHistory, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, recurring, recurringNewRec, reportDateFrom, reportDateTo, reportRange, reportType, rules, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setAiStep, setAiSuggestion, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setChatHistory, setChatLoading, setChatOpen, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchQueue, setNotification, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view, loadFailures, companyDataLoaded } = useERP();
  // C432 — ONE SEND AT A TIME. A second click on "Send Invoice →" while the first was in
  // flight minted a second invoice with its own id, booked a second A/R entry and sent a
  // second email — the O123 shape on the owner's invoice. The gate (C401's helper) runs the
  // handler once; the buttons are disabled and read "Sending…" meanwhile.
  const [sending, setSending] = React.useState(false);
  const sendGate = React.useRef(makeOneInFlight({ onBusy: setSending }));

            const fmt = fmtMoney;
            const nextNum = `INV-${String((sentInvoices.length+1)).padStart(4,"0")}`;
            const emptyLine = emptyInvoiceLine;
            // Render-time draft: always a complete object. tax_rate pre-fills from the
            // saved company default (migration 042), overridable per invoice.
            const draft = sendInvoiceDraftState || sentInvoiceDraft ||
              newInvoiceDraft({ invoiceNumber: nextNum, salesTaxRate: companySettings?.salesTaxRate });
            const setSendDraft = setSendInvoiceDraftState;
            // Functional updates MUST spread from a complete object — the raw state is
            // null on a fresh draft, so reading d.line_items off it would throw. base()
            // returns the live state if present, else the resolved render-time draft.
            const setDraft = (next) => setSendDraft(typeof next === "function" ? (d) => next(draftBase(d, draft)) : next);
            const showPreview = sendInvoiceShowPreview; const setShowPreview = setSendInvoiceShowPreview;

            const updateLine = (id, field, val) => {
              setDraft(d => ({...d, line_items: d.line_items.map(l => {
                if (l.id!==id) return l;
                const updated = {...l, [field]:val};
                if (field==="qty"||field==="rate") updated.amount = (parseFloat(updated.qty)||0)*(parseFloat(updated.rate)||0);
                return updated;
              })}));
            };
            const subtotal = draft.line_items.reduce((s,l)=>s+(l.amount||0),0);
            // Per-invoice editable blended sales-tax rate (Step 1: starts at 0/blank;
            // Step 2 will pre-fill from a saved company default). Sales tax is a
            // liability (Cr 2350), never revenue.
            const taxRatePct = parseFloat(draft.tax_rate) || 0;
            const taxRate = taxRatePct / 100;
            const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
            const total = Math.round((subtotal + taxAmount) * 100) / 100;

            const today = todayLocal();

            // Persist (insert or update) into the sent-invoices list.
            // The app can send only with a domain AND a channel set up; a member who cannot see
            // the token still sees `status.configured`, which is all this needs.
            const sendBlockers = invoiceSendBlockers(draft, subtotal);   // C412 — shown before the click, and the button is disabled while any remain
            const canSendFromApp = !!MAIL_DOMAIN && !!(mailChannel?.channel || mailChannel?.status?.configured);
            const persistSentLocal = (inv) => setSentInvoices(prev => {
              const i = prev.findIndex(x => x.id === inv.id);
              if (i >= 0) { const u = [...prev]; u[i] = inv; return u; }
              return [inv, ...prev];
            });
            // ★ C350 — WRITE THE INVOICE, NOT JUST THE STATE. `ar_invoices` was read on every
            // load and written by nothing, so a sent invoice lived until the next reload. The
            // header goes in first and the lines against its id; a failure is SAID and the
            // invoice stays on screen in-session (as before), never claimed as saved.
            // Returns the invoice carrying its database id, or the input on failure.
            const persistSent = async (inv, customerId = null) => {
              persistSentLocal(inv);
              if (!currentCompany?.id) return inv;
              const { header, lines } = arInvoiceRows(inv, { companyId: currentCompany.id, customerId, userId: session?.user?.id || null, taxAmount: inv.tax_amount || 0 });
              header.updated_at = new Date().toISOString();
              try {
                let dbId = isDbInvoiceId(inv.id) ? inv.id : null;
                if (dbId) {
                  const r = await checkedRowUpdate({ supabase, table: "ar_invoices", id: dbId, companyId: currentCompany.id, patch: header, label: "ar_invoice_update" });
                  if (!r.ok) throw new Error("the invoice could not be updated");
                  const del = await supabase.from("ar_invoice_lines").delete().eq("ar_invoice_id", dbId).eq("company_id", currentCompany.id).select("id");
                  if (del.error) throw new Error(del.error.message);
                } else {
                  const ins = await supabase.from("ar_invoices").insert(header).select("id").single();
                  if (ins.error || !ins.data?.id) throw new Error(ins.error?.message || "no id returned");
                  dbId = ins.data.id;
                }
                if (lines.length) {
                  const li = await supabase.from("ar_invoice_lines").insert(lines.map(l => ({ ...l, ar_invoice_id: dbId }))).select("id");
                  if (li.error) throw new Error(li.error.message);
                  if ((li.data || []).length !== lines.length) throw new Error(`${(li.data || []).length} of ${lines.length} lines saved`);
                }
                const saved = { ...inv, id: dbId };
                setSentInvoices(prev => prev.map(x => x.id === inv.id ? saved : x));
                return saved;
              } catch (e) {
                console.error("[ar_invoices] persist failed:", e);
                logAudit("invoice_persist_failed", `Invoice ${inv.invoice_number} could not be saved — ${e?.message || "unknown error"}`);
                showNotification(`Invoice ${inv.invoice_number} is in your books, but we couldn't save the invoice itself — it will not be here after a reload.`, "error");
                return inv;
              }
            };

            // ★ C353 — THE CUSTOMER IS RESOLVED TO A DATABASE ID BEFORE THE INVOICE IS SAVED.
            // `ensureCustomer` fired `createOrUpdateContact` and did not wait, so the contact's
            // id was an in-session float at persist time — `ar_invoices.customer_id` is a uuid,
            // so the invoice insert would have FAILED on its own foreign key, and a row that did
            // land with `customer_id: null` came back after a reload with NO customer name (the
            // load maps the name from `contacts`). Awaited, through the same `persistContact`
            // the vendor form uses; a contact we cannot resolve leaves the id null and is SAID.
            const resolveCustomerId = async () => {
              const name = (draft.customer || "").trim(); if (!name) return null;
              const email = (draft.customer_email || "").trim();
              const norm = (x) => String(x || "").trim().toLowerCase();
              const existing = contacts.find(c => c.type === "customer" && norm(c.name) === norm(name));
              const dbId = existing ? contactDbId(existing) : null;
              if (dbId) return dbId;
              const r = await persistContact({ ...(existing || {}), name, type: "customer", email: email || existing?.email || "" });
              if (r?.ok && r.row?.id) {
                setContacts(prev => existing
                  ? prev.map(c => c.id === existing.id ? { ...c, db_id: r.row.id } : c)
                  : [{ ...r.row, fromContact: true }, ...prev]);
                return r.row.id;
              }
              return null;
            };

            // Book the issued invoice through the canonical multi-line path:
            //   Dr A/R / Cr Revenue [ / Cr Sales Tax Payable ].  Returns the posted
            //   journal-entry id (used as ledger_id), or null on failure/pre-cutoff.
            const bookAR = async (inv) => {
              const rev = getAccountByRole("product_revenue");
              const ar  = getAccountByRole("accounts_receivable");
              const tax = getAccountByRole("sales_tax_payable");
              const issueDate = inv.issue_date || today;
              if (!assertBookable(issueDate)) return null;   // pre-cutoff → reject before posting
              const je = buildArInvoiceEntry({
                subtotal, taxRate,
                arCode: ar?.code, revenueCode: rev?.code, salesTaxCode: tax?.code || "2350",
                date: issueDate, customer: inv.customer, invoiceNumber: inv.invoice_number,
                dueDate: inv.due_date || null,
                description: `${inv.customer} – Invoice ${inv.invoice_number}`,
              });
              if (!je || !je.balanced) { showNotification("Couldn't build the invoice entry.", "error"); return null; }
              const jeId = await persistMultiLineEntry(je);
              if (!jeId) return null;   // failure already surfaced (e.g. pre-cutoff)
              try { await loadAllData(); } catch {}   // surface the posted A/R (+ tax) entry
              return jeId;
            };

            const saveDraft = async () => {
              const inv = {...draft, id: draft.id||Date.now()+Math.random(), status: draft.status || "draft", updated_at:new Date().toISOString()};
              if (!inv.created_at) inv.created_at = new Date().toISOString();
              const customerId = await resolveCustomerId();
              const saved = await persistSent(inv, customerId);
              setSentInvoiceDraft(saved); setDraft(saved);
              logAudit("invoice_created",`Invoice ${inv.invoice_number} draft saved for ${inv.customer} ${fmt(total)}`);
              showNotification(`Invoice ${inv.invoice_number} saved ✓`);
            };

            // Issue the invoice: save it, create the customer, book A/R, and open the
            // user's email client pre-filled so they can actually send it.
            const sendInvoice = () => sendGate.current.run(sendInvoiceOnce);
            const sendInvoiceOnce = async () => {
              if (sendBlockers.length) { showNotification(sendBlockers[0], "error"); return; }   // C412 — the same list the screen shows; the button is disabled, this is the net
              const customerId = await resolveCustomerId();
              const inv = {...draft, id: draft.id||Date.now()+Math.random(), status:"sent", sent_at:new Date().toISOString(), tax_rate: draft.tax_rate || "", tax_amount: taxAmount,
                due_date: draft.due_date || deriveDueDate(draft.issue_date, draft.terms) || ""};   // C451 — the stored row and the A/R entry carry the due date the terms imply, so "overdue" can be told
              if (!inv.created_at) inv.created_at = new Date().toISOString();
              // Book the A/R entry exactly once per invoice; keep it in sync on re-send.
              if (inv.ledger_id) {
                setInvoices(prev => prev.map(e => String(e.id)===String(inv.ledger_id) ? {...e, amount:total, date:inv.issue_date||today, vendor:inv.customer, due_date:inv.due_date||undefined} : e));
              } else {
                const jeId = await bookAR(inv);
                if (!jeId) return;   // pre-cutoff issue date → blocked + toasted; don't send/persist
                inv.ledger_id = jeId;
              }
              const saved = await persistSent(inv, customerId); setSentInvoiceDraft(saved); setDraft(saved);
              logAudit("invoice_sent", `Invoice ${inv.invoice_number} sent to ${inv.customer} — ${fmt(total)} · recorded as money owed to you`);
              const lineSummary = (inv.line_items||[]).map(l => `• ${l.description||"Item"} — ${fmt(l.amount)}`).join("\n");
              const subject = `Invoice ${inv.invoice_number} from ${companySettings.name||"Your Company"}`;
              // C437 — the customer's email said "for ${subtotal}" and "Total due: ${subtotal}" — the amount
              // BEFORE sales tax — while the invoice it accompanied showed the taxed total. A customer
              // paying what the email said would have short-paid by the tax. The email reads the same
              // total the invoice does, and itemises the tax when there is one.
              const taxLine = taxAmount > 0 ? `\nSales tax (${taxRatePct}%): ${fmt(taxAmount)}` : "";
              const body = `Hi ${inv.customer},\n\nPlease find invoice ${inv.invoice_number} for ${fmt(total)}, due ${invoiceDueLabel(inv, fmtDate).replace(/^On receipt$/, "on receipt")}.\n\n${lineSummary}${taxAmount > 0 ? `\n\nSubtotal: ${fmt(subtotal)}${taxLine}` : ""}\n\nTotal due: ${fmt(total)}\n\nThank you,\n${companySettings.name||"Your Company"}`;
              // ★ O82 (C351) — SEND FROM THE APP WHEN THE CHANNEL EXISTS; otherwise the person's
              // own mail client, as before — and the button SAYS which (a silent fallback is
              // the C194 shape: "sent" over something that opened a compose window).
              if (canSendFromApp && isDbInvoiceId(saved.id)) {
                const r = await sendChannelMail({ kind: "invoice", to: inv.customer_email, subject, text: body, related: { arInvoiceId: saved.id } });
                if (r.ok) showNotification(`Invoice ${inv.invoice_number} sent to ${inv.customer_email} — recorded as money owed to you ✓`);
                else showNotification(`Invoice ${inv.invoice_number} is in your books but was NOT sent — ${plainWriteError(r.error, "the email didn't go out")}. Open it and use your own mail app instead.`, "error");
                return;
              }
              try { window.location.href = `mailto:${encodeURIComponent(inv.customer_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; } catch(e) { /* no mail client */ }
              showNotification(`Invoice ${inv.invoice_number} recorded as money owed to you ✓. It's open in your mail app to send.`);
            };

            const downloadPDF = () => {
              // HTML-escape every user-controlled field before it goes into the print
              // window markup, so a vendor/customer/line-item value containing markup
              // (e.g. "<script>") can't execute (stored XSS hardening).
              const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
              // Build a clean HTML invoice and open print dialog
              const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(draft.invoice_number)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111;font-size:14px}
  .header{display:flex;justify-content:space-between;margin-bottom:40px}
  .company{font-size:22px;font-weight:700}
  .invoice-meta{text-align:right}
  .invoice-number{font-size:28px;font-weight:700;color:#B9962E}
  table{width:100%;border-collapse:collapse;margin:24px 0}
  th{background:#111;color:#fff;padding:10px 12px;text-align:left;font-size:12px;letter-spacing:1px;text-transform:uppercase}
  td{padding:10px 12px;border-bottom:1px solid #e5e5e5}
  .totals{margin-left:auto;width:280px;margin-top:16px}
  .total-row{display:flex;justify-content:space-between;padding:6px 0}
  .grand-total{font-size:18px;font-weight:700;border-top:2px solid #111;padding-top:10px;margin-top:6px}
  .footer{margin-top:40px;padding-top:20px;border-top:1px solid #e5e5e5;color:#888;font-size:12px}
</style></head><body>
<div class="header">
  <div>
    <div class="company">${esc(companySettings.name||"Your Company")}</div>
    <div style="margin-top:4px;color:#888">${esc(companySettings.address||"")} ${esc(companySettings.city||"")} ${esc(companySettings.state||"")}</div>
    <div style="color:#888">${companySettings.taxId?"EIN: "+esc(companySettings.taxId):""}</div>
  </div>
  <div class="invoice-meta">
    <div class="invoice-number">${esc(draft.invoice_number)}</div>
    <div style="margin-top:8px"><strong>Bill To:</strong> ${esc(draft.customer)}${draft.customer_address ? `<br>${esc(draft.customer_address)}` : ""}</div>
    <div style="color:#888">${esc(draft.customer_email||"")}</div>
    <div style="margin-top:8px">Issue Date: ${esc(draft.issue_date ? fmtDate(draft.issue_date) : "")}</div>
    <div>Due Date: ${esc(invoiceDueLabel(draft, fmtDate))}</div>
    ${draft.terms ? `Terms: ${esc(draft.terms)}` : ""}
  </div>
</div>
<table>
  <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>
    ${draft.line_items.map(l=>`<tr><td>${esc(l.description||"")}</td><td style="text-align:right">${parseFloat(l.qty||0)}</td><td style="text-align:right">${fmtMoney(parseFloat(l.rate||0))}</td><td style="text-align:right">${fmtMoney(Number(l.amount)||0)}</td></tr>`).join("")}
  </tbody>
</table>
<div class="totals">
  <div class="total-row"><span>Subtotal</span><span>${fmtMoney(subtotal)}</span></div>
  ${taxAmount>0?`<div class="total-row"><span>Sales tax (${taxRatePct}%)</span><span>${fmtMoney(taxAmount)}</span></div>`:""}
  <div class="total-row grand-total"><span>Total Due</span><span>${fmtMoney(total)}</span></div>
</div>
${draft.notes?`<div class="footer">Notes: ${esc(draft.notes)}</div>`:""}
</body></html>`;
              const w = window.open("","_blank");
              w.document.write(html);
              w.document.close();
              w.print();
              logAudit("invoice_printed",`Invoice ${draft.invoice_number} printed/PDF'd`);
            };

            const markInvoicePaid = async (inv) => {
              // C399 — the list flips to "paid" only once the payment is in the books (C238:
              // the screen follows the database). It used to flip first, so a refused
              // payment left the invoice reading paid until the next reload.
              const paintPaid = () => setSentInvoices(prev=>prev.map(i=>i.id===inv.id?{...i,status:"paid",paid_at:new Date().toISOString()}:i));
              const amt = invoiceTotalOf(inv);   // C438 — with its sales tax
              if (inv.ledger_id) {
                // Collect the existing A/R through the canonical poster: posts Dr Cash / Cr A/R
                // and persists payment_status='collected'. (Was a local flag flip that never
                // hit the GL — so A/R was never cleared and the figure couldn't reconcile.)
                const ok = await markBillPaid(inv.ledger_id, { side: "ar" });
                if (!ok) return;                      // the poster said why; the list is unchanged
                paintPaid();
                if (isDbInvoiceId(inv.id)) {
                  // The invoice row follows the ledger: paid there, paid here. A failure is
                  // reported — the books are right, and the list would be wrong after a reload.
                  const r = await checkedRowUpdate({ supabase, table: "ar_invoices", id: inv.id, companyId: currentCompany.id, patch: { status: "paid", paid_at: new Date().toISOString() }, label: "ar_invoice_paid" });
                  if (!r.ok) showNotification(`Payment recorded in your books, but the invoice list couldn't be updated — it may still show ${inv.invoice_number} as unpaid after a reload.`, "error");
                }
                try { await loadAllData(); } catch {}
              } else {
                // Legacy invoice issued before A/R booking existed — book revenue now.
                const rev = getAccountByRole("product_revenue"); const cash = getAccountByRole("cash");
                const entry = {
                  id:Date.now()+Math.random(), vendor:inv.customer, description:`Payment received – ${inv.invoice_number}`,
                  amount:amt, date:todayLocal(),
                  type:"revenue", gl_code:rev?.code, gl_name:rev?.name,
                  secondary_gl_code:cash?.code, secondary_gl_name:cash?.name,
                  debit_credit:"credit", confidence:100, reasoning:`Invoice ${inv.invoice_number} paid`,
                  status:"booked", booked_at:new Date().toISOString(), source:"sent_invoice", payment_status:"collected"
                };
                setInvoices(prev=>[entry,...prev]);
                const jeId = await bookToDb(entry);   // C371 — the ✓ reads the write
                if (!jeId) return;                    // the writer said why; nothing was marked
                paintPaid();
                logAudit("invoice_paid",`Invoice ${inv.invoice_number} marked paid – ${fmt(amt)}`);
              }
              showNotification(`${inv.invoice_number} marked paid ✓`);
            };

            // Professional on-screen invoice preview.
            const PreviewCard = () => (
              <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,padding:"40px 44px",maxWidth:760,margin:"0 auto",boxShadow:"0 1px 3px rgba(16,24,40,0.1)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:24,flexWrap:"wrap",marginBottom:36}}>
                  <div style={{minWidth:0}}>
                    {companySettings.logoBase64 && <img src={companySettings.logoBase64} alt="" style={{height:44,marginBottom:10,objectFit:"contain"}}/>}
                    <div style={{fontSize:22,fontWeight:700,color:"var(--sc-text)"}}>{companySettings.name||"Your Company"}</div>
                    {companySettings.address && <div style={{fontSize:12,color:"var(--sc-text-mut)",marginTop:4}}>{companySettings.address}</div>}
                    {[companySettings.city,companySettings.state].filter(Boolean).length>0 && <div style={{fontSize:12,color:"var(--sc-text-mut)"}}>{[companySettings.city,companySettings.state].filter(Boolean).join(", ")}</div>}
                    {companySettings.taxId && <div style={{fontSize:12,color:"var(--sc-text-mut)"}}>EIN: {companySettings.taxId}</div>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:12,letterSpacing:2,color:"var(--sc-text-mut)",fontWeight:600}}>INVOICE</div>
                    <div style={{fontSize:24,fontWeight:700,color:"var(--sc-gold)",fontFamily:"'DM Mono',monospace"}}>{draft.invoice_number}</div>
                    <div style={{fontSize:12,color:"var(--sc-text-2)",marginTop:10,lineHeight:1.8}}>
                      <div>Issue date: <strong style={{color:"var(--sc-text)"}}>{draft.issue_date?fmtDate(draft.issue_date):"—"}</strong></div>
                      <div>Due date: <strong style={{color:"var(--sc-text)"}}>{invoiceDueLabel(draft, fmtDate)}</strong></div>
                      <div>Terms: <strong style={{color:"var(--sc-text)"}}>{draft.terms||"Net 30"}</strong></div>
                    </div>
                  </div>
                </div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:11,letterSpacing:1,color:"var(--sc-text-mut)",fontWeight:600,marginBottom:4}}>BILL TO</div>
                  <div style={{fontSize:15,fontWeight:600,color:"var(--sc-text)"}}>{draft.customer||"—"}</div>
                  {draft.customer_address && <div style={{fontSize:12,color:"var(--sc-text-2)",whiteSpace:"pre-line"}}>{draft.customer_address}</div>}
                  {draft.customer_email && <div style={{fontSize:12,color:"var(--sc-text-mut)"}}>{draft.customer_email}</div>}
                </div>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr style={{background:"var(--sc-text)"}}>
                    {["Description","Qty","Rate","Amount"].map((h,i)=><th key={h} style={{padding:"10px 12px",textAlign:i===0?"left":"right",fontSize:11,letterSpacing:0.8,color:"var(--sc-on-accent)",textTransform:"uppercase",fontWeight:600}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {draft.line_items.map(l=>(
                      <tr key={l.id} style={{borderBottom:"1px solid var(--sc-border)"}}>
                        <td style={{padding:"11px 12px",fontSize:13,color:"var(--sc-text)"}}>{l.description||"—"}</td>
                        <td style={{padding:"11px 12px",fontSize:13,color:"var(--sc-text-2)",textAlign:"right",fontFamily:"'DM Mono',monospace"}}>{l.qty}</td>
                        <td style={{padding:"11px 12px",fontSize:13,color:"var(--sc-text-2)",textAlign:"right",fontFamily:"'DM Mono',monospace"}}>{fmt(parseFloat(l.rate||0))}</td>
                        <td style={{padding:"11px 12px",fontSize:13,color:"var(--sc-text)",textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:600}}>{fmt(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{display:"flex",justifyContent:"flex-end",marginTop:16}}>
                  <div style={{width:260}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"var(--sc-text-2)",padding:"6px 0"}}><span>Subtotal</span><span style={{fontFamily:"'DM Mono',monospace"}}>{fmt(subtotal)}</span></div>
                    {taxAmount>0 && <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"var(--sc-text-2)",padding:"6px 0"}}><span>Sales tax ({taxRatePct}%)</span><span style={{fontFamily:"'DM Mono',monospace"}}>{fmt(taxAmount)}</span></div>}
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:16,fontWeight:700,borderTop:"2px solid var(--sc-text)",paddingTop:10,marginTop:4}}><span>Total due</span><span style={{fontFamily:"'DM Mono',monospace",color:"var(--sc-success)"}}>{fmt(total)}</span></div>
                  </div>
                </div>
                {draft.notes && <div style={{marginTop:32,paddingTop:20,borderTop:"1px solid var(--sc-border)",fontSize:12,color:"var(--sc-text-mut)",lineHeight:1.6}}>{draft.notes}</div>}
              </div>
            );

            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"var(--sc-text-2)",marginBottom:8}}>SEND AN INVOICE</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Send Invoice</h1>
                </div>

                {showPreview && (
                  <div>
                    <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:16,flexWrap:"wrap"}}>
                      <button onClick={()=>setShowPreview(false)} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"var(--sc-surface)",border:"1px solid var(--sc-border-2)",color:"var(--sc-text-2)",cursor:"pointer"}}>← Edit</button>
                      <button onClick={sendInvoice} disabled={sendBlockers.length > 0 || sending} data-send-blocked={sendBlockers.length > 0 ? "true" : undefined} data-sending={sending ? "true" : undefined} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:(sendBlockers.length || sending) ? "var(--sc-border)" : "linear-gradient(135deg,var(--sc-success),var(--sc-success))",border:"none",color:(sendBlockers.length || sending) ? "var(--sc-text-mut)" : "var(--sc-on-accent)",cursor:(sendBlockers.length || sending) ? "not-allowed" : "pointer"}}>{sending ? "Sending…" : canSendFromApp ? "Send Invoice →" : "Send from my mail app →"}</button>
                      <button onClick={downloadPDF} style={{padding:"9px 22px",borderRadius:9,fontSize:13,background:"var(--sc-surface)",border:"1px solid var(--sc-border-2)",color:"var(--sc-text-2)",cursor:"pointer"}}>Download / Print PDF</button>
                    </div>
                    <PreviewCard/>
                  </div>
                )}

                <div style={{display: showPreview ? "none" : "grid",gridTemplateColumns:"1fr 380px",gap:20,alignItems:"flex-start"}}>
                  {/* Editor */}
                  <div>
                    <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,padding:24,marginBottom:16}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                        <div>
                          <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>INVOICE NUMBER</div>
                          <input value={draft.invoice_number} onChange={e=>setDraft(d=>({...d,invoice_number:e.target.value}))}
                            style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 12px",color:"var(--sc-gold)",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace",fontWeight:600}}/>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>TERMS</div>
                          <select value={draft.terms} onChange={e=>setDraft(d=>({...d,terms:e.target.value}))}
                            style={{width:"100%",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}>
                            {INVOICE_TERM_OPTIONS.map(t=><option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>BILL TO</div>
                          <input value={draft.customer} onChange={e=>{ const name=e.target.value; const c=findContactForName((contacts||[]).filter(x=>x.type==="customer"), name, aliasIndex); setDraft(d=>({...d,customer:name, ...customerDefaultsFor(c, d)})); }} placeholder="Customer name"
                            list="customer-list"
                            style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}/>
                          <datalist id="customer-list">{contacts.filter(c=>c.type==="customer").map(c=><option key={c.id} value={c.name}/>)}</datalist>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>EMAIL</div>
                          <input type="email" value={draft.customer_email} onChange={e=>setDraft(d=>({...d,customer_email:e.target.value}))} placeholder="customer@email.com"
                            style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>MAILING ADDRESS</div>
                          <input value={draft.customer_address||""} onChange={e=>setDraft(d=>({...d,customer_address:e.target.value}))} placeholder="Street, city, state ZIP"
                            style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>ISSUE DATE</div>
                          <input type="date" value={draft.issue_date} onChange={e=>setDraft(d=>({...d,issue_date:e.target.value}))}
                            style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>DUE DATE</div>
                          <input type="date" value={draft.due_date} onChange={e=>setDraft(d=>({...d,due_date:e.target.value}))}
                            style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}/>
                        </div>
                      </div>

                      {/* Line items */}
                      <div style={{marginBottom:12}}>
                        <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:8,letterSpacing:1}}>LINE ITEMS</div>
                        {draft.line_items.map((line,i)=>(
                          <div key={line.id} style={{display:"grid",gridTemplateColumns:"3fr 80px 100px 100px 36px",gap:8,marginBottom:8,alignItems:"center"}}>
                            <input value={line.description} onChange={e=>updateLine(line.id,"description",e.target.value)} placeholder="Description of service or product"
                              style={{background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none"}}/>
                            <input type="number" value={line.qty} onChange={e=>updateLine(line.id,"qty",e.target.value)} placeholder="Qty"
                              style={{background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none",textAlign:"center"}}/>
                            <input type="number" value={line.rate} onChange={e=>updateLine(line.id,"rate",e.target.value)} placeholder="Rate"
                              style={{background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none",textAlign:"right"}}/>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"right",color:"var(--sc-text)",padding:"0 4px"}}>{fmt(line.amount)}</div>
                            <button onClick={()=>setDraft(d=>({...d,line_items:d.line_items.filter(l=>l.id!==line.id)}))} style={{background:"transparent",border:"1px solid var(--sc-border-2)",borderRadius:7,color:"var(--sc-error)",cursor:"pointer",fontSize:14,padding:"6px"}}>×</button>
                          </div>
                        ))}
                        <button onClick={()=>setDraft(d=>({...d,line_items:[...d.line_items,emptyLine()]}))} style={{fontSize:12,background:"transparent",border:"1px dashed var(--sc-border-2)",borderRadius:8,padding:"7px 16px",color:"var(--sc-text-2)",cursor:"pointer",marginTop:4}}>+ Add Line</button>
                      </div>

                      {/* Notes */}
                      <div>
                        <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>NOTES / PAYMENT INSTRUCTIONS</div>
                        <textarea value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} rows={2} placeholder="Thank you for your business. Please remit payment by due date."
                          style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 12px",color:"var(--sc-text-2)",fontSize:12,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
                      </div>
                    </div>

                    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                      <button onClick={sendInvoice} disabled={sendBlockers.length > 0 || sending} data-send-blocked={sendBlockers.length > 0 ? "true" : undefined} data-sending={sending ? "true" : undefined} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:(sendBlockers.length || sending) ? "var(--sc-border)" : "linear-gradient(135deg,var(--sc-success),var(--sc-success))",border:"none",color:(sendBlockers.length || sending) ? "var(--sc-text-mut)" : "var(--sc-on-accent)",cursor:(sendBlockers.length || sending) ? "not-allowed" : "pointer"}}>{sending ? "Sending…" : canSendFromApp ? "Send Invoice →" : "Send from my mail app →"}</button>
                      <button onClick={()=>setShowPreview(true)} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"var(--sc-surface)",border:"1px solid var(--sc-border-2)",color:"var(--sc-text-2)",cursor:"pointer"}}>Preview</button>
                      <button onClick={saveDraft} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"var(--sc-gold-soft)",border:"1px solid var(--sc-gold-soft)",color:"var(--sc-gold)",cursor:"pointer"}}>Save Draft</button>
                      <button onClick={downloadPDF} style={{padding:"9px 22px",borderRadius:9,fontSize:13,background:"var(--sc-surface)",border:"1px solid var(--sc-border-2)",color:"var(--sc-text-2)",cursor:"pointer"}}>Download / Print PDF</button>
                    </div>
                    {sendBlockers.length > 0 && (
                      <div data-send-blockers style={{marginTop:10,fontSize:12,color:"var(--sc-text-2)",lineHeight:1.6}}>
                        <div style={{fontWeight:600,marginBottom:2}}>Before you can send:</div>
                        {sendBlockers.map(b => <div key={b}>• {b}</div>)}
                      </div>
                    )}
                  </div>

                  {/* Right panel: totals + invoice list */}
                  <div>
                    {/* Total card */}
                    <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,padding:20,marginBottom:16}}>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:12,letterSpacing:1}}>INVOICE TOTAL</div>
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"var(--sc-text-2)"}}><span>Subtotal</span><span style={{fontFamily:"'DM Mono',monospace"}}>{fmt(subtotal)}</span></div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:13,color:"var(--sc-text-2)"}}>
                          <span style={{display:"flex",alignItems:"center",gap:6}}>Sales tax
                            <input type="number" min="0" step="0.01" value={draft.tax_rate??""} onChange={e=>setDraft(d=>({...d,tax_rate:e.target.value}))} placeholder="0" style={{width:62,height:30,borderRadius:7,border:"1px solid var(--sc-border-2)",padding:"0 8px",fontSize:13,textAlign:"right"}} />%
                          </span>
                          <span style={{fontFamily:"'DM Mono',monospace"}}>{fmt(taxAmount)}</span>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:16,fontWeight:700,borderTop:"1px solid var(--sc-border-2)",paddingTop:10,marginTop:4}}><span>Total Due</span><span style={{fontFamily:"'DM Mono',monospace",color:"var(--sc-success)"}}>{fmt(total)}</span></div>
                      </div>
                    </div>

                    {/* Recent invoices */}
                    <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,overflow:"hidden"}}>
                      <div style={{padding:"12px 16px",borderBottom:"1px solid var(--sc-border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{fontSize:12,fontWeight:600,color:"var(--sc-gold)"}}>RECENT INVOICES</div>
                        <button onClick={()=>setDraft(newInvoiceDraft({ invoiceNumber: nextNum, salesTaxRate: companySettings?.salesTaxRate }))} style={{fontSize:11,background:"transparent",border:"1px solid var(--sc-border-2)",borderRadius:7,padding:"3px 10px",color:"var(--sc-text-2)",cursor:"pointer"}}>+ New</button>
                      </div>
                      {loadFailures?.ar_invoices ? <LoadFailedNotice what="sent invoices" table="ar_invoices" /> : !companyDataLoaded ? <LoadingList what="your invoices" /> : sentInvoices.length===0 ? (
                        <div style={{padding:24,textAlign:"center",color:"var(--sc-text-2)",fontSize:12}}>No invoices yet</div>
                      ) : sentInvoices.slice(0,8).map(inv=>{
                        const invTotal = invoiceTotalOf(inv);   // C438 — with its sales tax
                        return (
                          <div key={inv.id} style={{padding:"12px 16px",borderTop:"1px solid var(--sc-border)",cursor:"pointer",background:"transparent"}}
                            onClick={()=>setDraft(inv)}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                              <div>
                                <div style={{fontSize:12,fontWeight:600,fontFamily:"'DM Mono',monospace",color:"var(--sc-gold)"}}>{inv.invoice_number}</div>
                                <div style={{fontSize:11,color:"var(--sc-text-2)",marginTop:2}}>{inv.customer}</div>
                              </div>
                              <div style={{textAlign:"right"}}>
                                <div style={{fontSize:13,fontWeight:700,fontFamily:"'DM Mono',monospace",color:inv.status==="paid"?"var(--sc-success)":"var(--sc-text)"}}>{fmt(invTotal)}</div>
                                <span style={{fontSize:10,background:inv.status==="paid"?"var(--sc-success-soft)":inv.status==="draft"?"var(--sc-border)":"var(--sc-gold-soft)",color:inv.status==="paid"?"var(--sc-success)":inv.status==="draft"?"var(--sc-text-2)":"var(--sc-gold)",borderRadius:20,padding:"1px 7px"}}>{inv.status}</span>
                              </div>
                            </div>
                            {inv.status!=="paid" && (
                              <button onClick={e=>{e.stopPropagation();markInvoicePaid(inv);}} style={{marginTop:8,fontSize:11,padding:"4px 12px",borderRadius:7,background:"transparent",border:"1px solid var(--sc-success-soft)",color:"var(--sc-success)",cursor:"pointer"}}>Mark paid</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
}
