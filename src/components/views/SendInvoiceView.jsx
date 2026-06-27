import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { buildArInvoiceEntry } from "../../lib/revenueEntries";
import { newInvoiceDraft, emptyInvoiceLine, draftBase } from "../../lib/invoiceDraft";

export default function SendInvoiceView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, createOrUpdateContact, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, assertBookable, markBillPaid, persistMultiLineEntry, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
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

            const today = new Date().toISOString().slice(0,10);

            // Persist (insert or update) into the sent-invoices list.
            const persistSent = (inv) => setSentInvoices(prev => {
              const i = prev.findIndex(x => x.id === inv.id);
              if (i >= 0) { const u = [...prev]; u[i] = inv; return u; }
              return [inv, ...prev];
            });

            // Add/refresh the customer in contacts so they show up in AR + future invoices.
            const ensureCustomer = () => {
              if (draft.customer?.trim()) createOrUpdateContact({ name: draft.customer.trim(), type: "customer", email: (draft.customer_email||"").trim() });
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

            const saveDraft = () => {
              const inv = {...draft, id: draft.id||Date.now()+Math.random(), updated_at:new Date().toISOString()};
              if (!inv.created_at) inv.created_at = new Date().toISOString();
              ensureCustomer();
              persistSent(inv);
              setSentInvoiceDraft(inv); setDraft(inv);
              logAudit("invoice_created",`Invoice ${inv.invoice_number} draft saved for ${inv.customer} ${fmt(total)}`);
              showNotification(`Invoice ${inv.invoice_number} saved ✓`);
            };

            // Issue the invoice: save it, create the customer, book A/R, and open the
            // user's email client pre-filled so they can actually send it.
            const sendInvoice = async () => {
              if (!draft.customer?.trim()) { showNotification("Add a customer name first.", "error"); return; }
              if (!(draft.customer_email||"").trim()) { showNotification("Add the customer's email to send.", "error"); return; }
              if (!(subtotal > 0)) { showNotification("Add at least one line item with an amount.", "error"); return; }
              ensureCustomer();
              const inv = {...draft, id: draft.id||Date.now()+Math.random(), status:"sent", sent_at:new Date().toISOString(), tax_rate: draft.tax_rate || "", tax_amount: taxAmount};
              if (!inv.created_at) inv.created_at = new Date().toISOString();
              // Book the A/R entry exactly once per invoice; keep it in sync on re-send.
              if (inv.ledger_id) {
                setInvoices(prev => prev.map(e => String(e.id)===String(inv.ledger_id) ? {...e, amount:subtotal, date:inv.issue_date||today, vendor:inv.customer, due_date:inv.due_date||undefined} : e));
              } else {
                const jeId = await bookAR(inv);
                if (!jeId) return;   // pre-cutoff issue date → blocked + toasted; don't send/persist
                inv.ledger_id = jeId;
              }
              persistSent(inv); setSentInvoiceDraft(inv); setDraft(inv);
              logAudit("invoice_sent", `Invoice ${inv.invoice_number} sent to ${inv.customer} — ${fmt(subtotal)} · A/R booked`);
              const lineSummary = (inv.line_items||[]).map(l => `• ${l.description||"Item"} — ${fmt(l.amount)}`).join("\n");
              const subject = `Invoice ${inv.invoice_number} from ${companySettings.name||"Your Company"}`;
              const body = `Hi ${inv.customer},\n\nPlease find invoice ${inv.invoice_number} for ${fmt(subtotal)}, due ${inv.due_date?fmtDate(inv.due_date):"on receipt"}.\n\n${lineSummary}\n\nTotal due: ${fmt(subtotal)}\n\nThank you,\n${companySettings.name||"Your Company"}`;
              try { window.location.href = `mailto:${encodeURIComponent(inv.customer_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; } catch(e) { /* no mail client */ }
              showNotification(`Invoice ${inv.invoice_number} sent — A/R booked ✓`);
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
  .invoice-number{font-size:28px;font-weight:700;color:var(--sc-gold)}
  table{width:100%;border-collapse:collapse;margin:24px 0}
  th{background:var(--sc-text);padding:10px 12px;text-align:left;font-size:12px;letter-spacing:1px;text-transform:uppercase}
  td{padding:10px 12px;border-bottom:1px solid var(--sc-border)}
  .totals{margin-left:auto;width:280px;margin-top:16px}
  .total-row{display:flex;justify-content:space-between;padding:6px 0}
  .grand-total{font-size:18px;font-weight:700;border-top:2px solid #111;padding-top:10px;margin-top:6px}
  .footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--sc-border);color:#888;font-size:12px}
</style></head><body>
<div class="header">
  <div>
    <div class="company">${esc(companySettings.name||"Your Company")}</div>
    <div style="margin-top:4px;color:var(--sc-text-mut)">${esc(companySettings.address||"")} ${esc(companySettings.city||"")} ${esc(companySettings.state||"")}</div>
    <div style="color:var(--sc-text-mut)">${companySettings.taxId?"EIN: "+esc(companySettings.taxId):""}</div>
  </div>
  <div class="invoice-meta">
    <div class="invoice-number">${esc(draft.invoice_number)}</div>
    <div style="margin-top:8px"><strong>Bill To:</strong> ${esc(draft.customer)}</div>
    <div style="color:var(--sc-text-mut)">${esc(draft.customer_email||"")}</div>
    <div style="margin-top:8px">Issue Date: ${esc(draft.issue_date)}</div>
    <div>Due Date: ${esc(draft.due_date||"On Receipt")}</div>
    <div>Terms: ${esc(draft.terms||"Net 30")}</div>
  </div>
</div>
<table>
  <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>
    ${draft.line_items.map(l=>`<tr><td>${esc(l.description||"")}</td><td style="text-align:right">${parseFloat(l.qty||0)}</td><td style="text-align:right">$${parseFloat(l.rate||0).toFixed(2)}</td><td style="text-align:right">$${(Number(l.amount)||0).toFixed(2)}</td></tr>`).join("")}
  </tbody>
</table>
<div class="totals">
  <div class="total-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
  ${taxAmount>0?`<div class="total-row"><span>Sales tax (${taxRatePct}%)</span><span>$${taxAmount.toFixed(2)}</span></div>`:""}
  <div class="total-row grand-total"><span>Total Due</span><span>$${total.toFixed(2)}</span></div>
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
              setSentInvoices(prev=>prev.map(i=>i.id===inv.id?{...i,status:"paid",paid_at:new Date().toISOString()}:i));
              const amt = inv.line_items?.reduce((s,l)=>s+(l.amount||0),0)||0;
              if (inv.ledger_id) {
                // Collect the existing A/R through the canonical poster: posts Dr Cash / Cr A/R
                // and persists payment_status='collected'. (Was a local flag flip that never
                // hit the GL — so A/R was never cleared and the figure couldn't reconcile.)
                const ok = await markBillPaid(inv.ledger_id, { side: "ar" });
                if (ok) { try { await loadAllData(); } catch {} }
              } else {
                // Legacy invoice issued before A/R booking existed — book revenue now.
                const rev = getAccountByRole("product_revenue"); const cash = getAccountByRole("cash");
                const entry = {
                  id:Date.now()+Math.random(), vendor:inv.customer, description:`Payment received – ${inv.invoice_number}`,
                  amount:amt, date:new Date().toISOString().slice(0,10),
                  type:"revenue", gl_code:rev?.code, gl_name:rev?.name,
                  secondary_gl_code:cash?.code, secondary_gl_name:cash?.name,
                  debit_credit:"credit", confidence:100, reasoning:`Invoice ${inv.invoice_number} paid`,
                  status:"booked", booked_at:new Date().toISOString(), source:"sent_invoice", payment_status:"collected"
                };
                setInvoices(prev=>[entry,...prev]); bookToDb(entry);
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
                      <div>Due date: <strong style={{color:"var(--sc-text)"}}>{draft.due_date?fmtDate(draft.due_date):"On receipt"}</strong></div>
                      <div>Terms: <strong style={{color:"var(--sc-text)"}}>{draft.terms||"Net 30"}</strong></div>
                    </div>
                  </div>
                </div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:11,letterSpacing:1,color:"var(--sc-text-mut)",fontWeight:600,marginBottom:4}}>BILL TO</div>
                  <div style={{fontSize:15,fontWeight:600,color:"var(--sc-text)"}}>{draft.customer||"—"}</div>
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
                  <div style={{fontSize:10,letterSpacing:3,color:"var(--sc-text-2)",marginBottom:8}}>ACCOUNTS RECEIVABLE</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Send Invoice</h1>
                </div>

                {showPreview && (
                  <div>
                    <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:16,flexWrap:"wrap"}}>
                      <button onClick={()=>setShowPreview(false)} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"var(--sc-surface)",border:"1px solid var(--sc-border-2)",color:"var(--sc-text-2)",cursor:"pointer"}}>← Edit</button>
                      <button onClick={sendInvoice} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,var(--sc-success),var(--sc-success))",border:"none",color:"var(--sc-on-accent)",cursor:"pointer"}}>Send Invoice →</button>
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
                            {["On Receipt","Net 15","Net 30","Net 60","Net 90"].map(t=><option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>BILL TO</div>
                          <input value={draft.customer} onChange={e=>setDraft(d=>({...d,customer:e.target.value}))} placeholder="Customer name"
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
                      <button onClick={sendInvoice} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,var(--sc-success),var(--sc-success))",border:"none",color:"var(--sc-on-accent)",cursor:"pointer"}}>Send Invoice →</button>
                      <button onClick={()=>setShowPreview(true)} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"var(--sc-surface)",border:"1px solid var(--sc-border-2)",color:"var(--sc-text-2)",cursor:"pointer"}}>Preview</button>
                      <button onClick={saveDraft} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"var(--sc-gold-soft)",border:"1px solid var(--sc-gold-soft)",color:"var(--sc-gold)",cursor:"pointer"}}>Save Draft</button>
                      <button onClick={downloadPDF} style={{padding:"9px 22px",borderRadius:9,fontSize:13,background:"var(--sc-surface)",border:"1px solid var(--sc-border-2)",color:"var(--sc-text-2)",cursor:"pointer"}}>Download / Print PDF</button>
                    </div>
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
                      {sentInvoices.length===0 ? (
                        <div style={{padding:24,textAlign:"center",color:"var(--sc-text-2)",fontSize:12}}>No invoices yet</div>
                      ) : sentInvoices.slice(0,8).map(inv=>{
                        const invTotal = inv.line_items?.reduce((s,l)=>s+(l.amount||0),0)||0;
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
                              <button onClick={e=>{e.stopPropagation();markInvoicePaid(inv);}} style={{marginTop:8,fontSize:11,padding:"4px 12px",borderRadius:7,background:"transparent",border:"1px solid var(--sc-success-soft)",color:"var(--sc-success)",cursor:"pointer"}}>Mark Paid → Collect A/R</button>
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
