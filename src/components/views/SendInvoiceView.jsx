import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function SendInvoiceView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, createOrUpdateContact, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, assertBookable, markBillPaid, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const nextNum = `INV-${String((sentInvoices.length+1)).padStart(4,"0")}`;
            const emptyLine = () => ({id:Date.now()+Math.random(),description:"",qty:1,rate:"",amount:0});
            const draft = sendInvoiceDraftState || sentInvoiceDraft || {
              invoice_number: nextNum, customer:"", customer_email:"",
              issue_date: new Date().toISOString().slice(0,10),
              due_date: "", notes:"", terms:"Net 30",
              line_items:[emptyLine()],
              status:"draft"
            };
            const setDraft = setSendInvoiceDraftState;
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
            const taxRate = 0; // user can add later when multi-currency/tax is built
            const total = subtotal * (1+taxRate);

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

            // Book the accounts-receivable ledger entry for an issued invoice: Dr A/R, Cr Revenue.
            const bookAR = (inv, amount) => {
              const rev = getAccountByRole("product_revenue");
              const ar  = getAccountByRole("accounts_receivable");
              const issueDate = inv.issue_date || today;
              if (!assertBookable(issueDate)) return null;   // pre-cutoff → reject before optimistic add
              const entry = {
                id: Date.now()+Math.random(), vendor: inv.customer,
                description: `Invoice ${inv.invoice_number} — ${inv.customer}`,
                amount, date: issueDate, due_date: inv.due_date || undefined,
                type: "revenue", gl_code: rev?.code, gl_name: rev?.name,
                secondary_gl_code: ar?.code, secondary_gl_name: ar?.name,
                debit_credit: "credit", confidence: 100,
                reasoning: `Accounts receivable booked when invoice ${inv.invoice_number} was issued to ${inv.customer}.`,
                status: "booked", booked_at: new Date().toISOString(),
                source: "sent_invoice", payment_status: "uncollected", invoice_number: inv.invoice_number,
              };
              setInvoices(prev => [entry, ...prev]);
              bookToDb(entry);
              return entry;
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
            const sendInvoice = () => {
              if (!draft.customer?.trim()) { showNotification("Add a customer name first.", "error"); return; }
              if (!(draft.customer_email||"").trim()) { showNotification("Add the customer's email to send.", "error"); return; }
              if (!(subtotal > 0)) { showNotification("Add at least one line item with an amount.", "error"); return; }
              ensureCustomer();
              const inv = {...draft, id: draft.id||Date.now()+Math.random(), status:"sent", sent_at:new Date().toISOString()};
              if (!inv.created_at) inv.created_at = new Date().toISOString();
              // Book the A/R entry exactly once per invoice; keep it in sync on re-send.
              if (inv.ledger_id) {
                setInvoices(prev => prev.map(e => String(e.id)===String(inv.ledger_id) ? {...e, amount:subtotal, date:inv.issue_date||today, vendor:inv.customer, due_date:inv.due_date||undefined} : e));
              } else {
                const ar = bookAR(inv, subtotal);
                if (!ar) return;   // pre-cutoff issue date → blocked + toasted; don't send/persist
                inv.ledger_id = ar.id;
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
  .invoice-number{font-size:28px;font-weight:700;color:#4F46E5}
  table{width:100%;border-collapse:collapse;margin:24px 0}
  th{background:#101828;padding:10px 12px;text-align:left;font-size:12px;letter-spacing:1px;text-transform:uppercase}
  td{padding:10px 12px;border-bottom:1px solid #eee}
  .totals{margin-left:auto;width:280px;margin-top:16px}
  .total-row{display:flex;justify-content:space-between;padding:6px 0}
  .grand-total{font-size:18px;font-weight:700;border-top:2px solid #111;padding-top:10px;margin-top:6px}
  .footer{margin-top:40px;padding-top:20px;border-top:1px solid #eee;color:#888;font-size:12px}
</style></head><body>
<div class="header">
  <div>
    <div class="company">${esc(companySettings.name||"Your Company")}</div>
    <div style="margin-top:4px;color:#666">${esc(companySettings.address||"")} ${esc(companySettings.city||"")} ${esc(companySettings.state||"")}</div>
    <div style="color:#666">${companySettings.taxId?"EIN: "+esc(companySettings.taxId):""}</div>
  </div>
  <div class="invoice-meta">
    <div class="invoice-number">${esc(draft.invoice_number)}</div>
    <div style="margin-top:8px"><strong>Bill To:</strong> ${esc(draft.customer)}</div>
    <div style="color:#666">${esc(draft.customer_email||"")}</div>
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
              <div style={{background:"#FFFFFF",border:"1px solid #E4E7EC",borderRadius:14,padding:"40px 44px",maxWidth:760,margin:"0 auto",boxShadow:"0 1px 3px rgba(16,24,40,0.1)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:24,flexWrap:"wrap",marginBottom:36}}>
                  <div style={{minWidth:0}}>
                    {companySettings.logoBase64 && <img src={companySettings.logoBase64} alt="" style={{height:44,marginBottom:10,objectFit:"contain"}}/>}
                    <div style={{fontSize:22,fontWeight:700,color:"#101828"}}>{companySettings.name||"Your Company"}</div>
                    {companySettings.address && <div style={{fontSize:12,color:"#667085",marginTop:4}}>{companySettings.address}</div>}
                    {[companySettings.city,companySettings.state].filter(Boolean).length>0 && <div style={{fontSize:12,color:"#667085"}}>{[companySettings.city,companySettings.state].filter(Boolean).join(", ")}</div>}
                    {companySettings.taxId && <div style={{fontSize:12,color:"#667085"}}>EIN: {companySettings.taxId}</div>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:12,letterSpacing:2,color:"#98A2B3",fontWeight:600}}>INVOICE</div>
                    <div style={{fontSize:24,fontWeight:700,color:"#4F46E5",fontFamily:"'DM Mono',monospace"}}>{draft.invoice_number}</div>
                    <div style={{fontSize:12,color:"#475467",marginTop:10,lineHeight:1.8}}>
                      <div>Issue date: <strong style={{color:"#101828"}}>{draft.issue_date?fmtDate(draft.issue_date):"—"}</strong></div>
                      <div>Due date: <strong style={{color:"#101828"}}>{draft.due_date?fmtDate(draft.due_date):"On receipt"}</strong></div>
                      <div>Terms: <strong style={{color:"#101828"}}>{draft.terms||"Net 30"}</strong></div>
                    </div>
                  </div>
                </div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:11,letterSpacing:1,color:"#98A2B3",fontWeight:600,marginBottom:4}}>BILL TO</div>
                  <div style={{fontSize:15,fontWeight:600,color:"#101828"}}>{draft.customer||"—"}</div>
                  {draft.customer_email && <div style={{fontSize:12,color:"#667085"}}>{draft.customer_email}</div>}
                </div>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr style={{background:"#101828"}}>
                    {["Description","Qty","Rate","Amount"].map((h,i)=><th key={h} style={{padding:"10px 12px",textAlign:i===0?"left":"right",fontSize:11,letterSpacing:0.8,color:"#fff",textTransform:"uppercase",fontWeight:600}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {draft.line_items.map(l=>(
                      <tr key={l.id} style={{borderBottom:"1px solid #EEF0F4"}}>
                        <td style={{padding:"11px 12px",fontSize:13,color:"#101828"}}>{l.description||"—"}</td>
                        <td style={{padding:"11px 12px",fontSize:13,color:"#475467",textAlign:"right",fontFamily:"'DM Mono',monospace"}}>{l.qty}</td>
                        <td style={{padding:"11px 12px",fontSize:13,color:"#475467",textAlign:"right",fontFamily:"'DM Mono',monospace"}}>{fmt(parseFloat(l.rate||0))}</td>
                        <td style={{padding:"11px 12px",fontSize:13,color:"#101828",textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:600}}>{fmt(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{display:"flex",justifyContent:"flex-end",marginTop:16}}>
                  <div style={{width:260}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#475467",padding:"6px 0"}}><span>Subtotal</span><span style={{fontFamily:"'DM Mono',monospace"}}>{fmt(subtotal)}</span></div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:16,fontWeight:700,borderTop:"2px solid #101828",paddingTop:10,marginTop:4}}><span>Total due</span><span style={{fontFamily:"'DM Mono',monospace",color:"#039855"}}>{fmt(total)}</span></div>
                  </div>
                </div>
                {draft.notes && <div style={{marginTop:32,paddingTop:20,borderTop:"1px solid #EEF0F4",fontSize:12,color:"#667085",lineHeight:1.6}}>{draft.notes}</div>}
              </div>
            );

            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#475467",marginBottom:8}}>ACCOUNTS RECEIVABLE</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Send Invoice</h1>
                </div>

                {showPreview && (
                  <div>
                    <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:16,flexWrap:"wrap"}}>
                      <button onClick={()=>setShowPreview(false)} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"#FFFFFF",border:"1px solid #D0D5DD",color:"#344054",cursor:"pointer"}}>← Edit</button>
                      <button onClick={sendInvoice} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,#059669,#039855)",border:"none",color:"#fff",cursor:"pointer"}}>Send Invoice →</button>
                      <button onClick={downloadPDF} style={{padding:"9px 22px",borderRadius:9,fontSize:13,background:"#FFFFFF",border:"1px solid #D0D5DD",color:"#344054",cursor:"pointer"}}>Download / Print PDF</button>
                    </div>
                    <PreviewCard/>
                  </div>
                )}

                <div style={{display: showPreview ? "none" : "grid",gridTemplateColumns:"1fr 380px",gap:20,alignItems:"flex-start"}}>
                  {/* Editor */}
                  <div>
                    <div style={{background:"#FFFFFF",border:"1px solid #E4E7EC",borderRadius:14,padding:24,marginBottom:16}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                        <div>
                          <div style={{fontSize:11,color:"#475467",marginBottom:4}}>INVOICE NUMBER</div>
                          <input value={draft.invoice_number} onChange={e=>setDraft(d=>({...d,invoice_number:e.target.value}))}
                            style={{width:"100%",boxSizing:"border-box",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 12px",color:"#4F46E5",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace",fontWeight:600}}/>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#475467",marginBottom:4}}>TERMS</div>
                          <select value={draft.terms} onChange={e=>setDraft(d=>({...d,terms:e.target.value}))}
                            style={{width:"100%",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 12px",color:"#101828",fontSize:13,outline:"none"}}>
                            {["On Receipt","Net 15","Net 30","Net 60","Net 90"].map(t=><option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#475467",marginBottom:4}}>BILL TO</div>
                          <input value={draft.customer} onChange={e=>setDraft(d=>({...d,customer:e.target.value}))} placeholder="Customer name"
                            list="customer-list"
                            style={{width:"100%",boxSizing:"border-box",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 12px",color:"#101828",fontSize:13,outline:"none"}}/>
                          <datalist id="customer-list">{contacts.filter(c=>c.type==="customer").map(c=><option key={c.id} value={c.name}/>)}</datalist>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#475467",marginBottom:4}}>EMAIL</div>
                          <input type="email" value={draft.customer_email} onChange={e=>setDraft(d=>({...d,customer_email:e.target.value}))} placeholder="customer@email.com"
                            style={{width:"100%",boxSizing:"border-box",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 12px",color:"#101828",fontSize:13,outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#475467",marginBottom:4}}>ISSUE DATE</div>
                          <input type="date" value={draft.issue_date} onChange={e=>setDraft(d=>({...d,issue_date:e.target.value}))}
                            style={{width:"100%",boxSizing:"border-box",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 12px",color:"#101828",fontSize:13,outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#475467",marginBottom:4}}>DUE DATE</div>
                          <input type="date" value={draft.due_date} onChange={e=>setDraft(d=>({...d,due_date:e.target.value}))}
                            style={{width:"100%",boxSizing:"border-box",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 12px",color:"#101828",fontSize:13,outline:"none"}}/>
                        </div>
                      </div>

                      {/* Line items */}
                      <div style={{marginBottom:12}}>
                        <div style={{fontSize:11,color:"#475467",marginBottom:8,letterSpacing:1}}>LINE ITEMS</div>
                        {draft.line_items.map((line,i)=>(
                          <div key={line.id} style={{display:"grid",gridTemplateColumns:"3fr 80px 100px 100px 36px",gap:8,marginBottom:8,alignItems:"center"}}>
                            <input value={line.description} onChange={e=>updateLine(line.id,"description",e.target.value)} placeholder="Description of service or product"
                              style={{background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 10px",color:"#101828",fontSize:12,outline:"none"}}/>
                            <input type="number" value={line.qty} onChange={e=>updateLine(line.id,"qty",e.target.value)} placeholder="Qty"
                              style={{background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 10px",color:"#101828",fontSize:12,outline:"none",textAlign:"center"}}/>
                            <input type="number" value={line.rate} onChange={e=>updateLine(line.id,"rate",e.target.value)} placeholder="Rate"
                              style={{background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 10px",color:"#101828",fontSize:12,outline:"none",textAlign:"right"}}/>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"right",color:"#101828",padding:"0 4px"}}>{fmt(line.amount)}</div>
                            <button onClick={()=>setDraft(d=>({...d,line_items:d.line_items.filter(l=>l.id!==line.id)}))} style={{background:"transparent",border:"1px solid #D0D5DD",borderRadius:7,color:"#D92D20",cursor:"pointer",fontSize:14,padding:"6px"}}>×</button>
                          </div>
                        ))}
                        <button onClick={()=>setDraft(d=>({...d,line_items:[...d.line_items,emptyLine()]}))} style={{fontSize:12,background:"transparent",border:"1px dashed #D0D5DD",borderRadius:8,padding:"7px 16px",color:"#475467",cursor:"pointer",marginTop:4}}>+ Add Line</button>
                      </div>

                      {/* Notes */}
                      <div>
                        <div style={{fontSize:11,color:"#475467",marginBottom:4}}>NOTES / PAYMENT INSTRUCTIONS</div>
                        <textarea value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} rows={2} placeholder="Thank you for your business. Please remit payment by due date."
                          style={{width:"100%",boxSizing:"border-box",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 12px",color:"#475467",fontSize:12,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
                      </div>
                    </div>

                    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                      <button onClick={sendInvoice} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,#059669,#039855)",border:"none",color:"#fff",cursor:"pointer"}}>Send Invoice →</button>
                      <button onClick={()=>setShowPreview(true)} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"#FFFFFF",border:"1px solid #D0D5DD",color:"#344054",cursor:"pointer"}}>Preview</button>
                      <button onClick={saveDraft} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"#EEF2FF",border:"1px solid #4F46E533",color:"#4F46E5",cursor:"pointer"}}>Save Draft</button>
                      <button onClick={downloadPDF} style={{padding:"9px 22px",borderRadius:9,fontSize:13,background:"#FFFFFF",border:"1px solid #D0D5DD",color:"#344054",cursor:"pointer"}}>Download / Print PDF</button>
                    </div>
                  </div>

                  {/* Right panel: totals + invoice list */}
                  <div>
                    {/* Total card */}
                    <div style={{background:"#FFFFFF",border:"1px solid #E4E7EC",borderRadius:14,padding:20,marginBottom:16}}>
                      <div style={{fontSize:11,color:"#475467",marginBottom:12,letterSpacing:1}}>INVOICE TOTAL</div>
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#475467"}}><span>Subtotal</span><span style={{fontFamily:"'DM Mono',monospace"}}>{fmt(subtotal)}</span></div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:16,fontWeight:700,borderTop:"1px solid #D0D5DD",paddingTop:10,marginTop:4}}><span>Total Due</span><span style={{fontFamily:"'DM Mono',monospace",color:"#039855"}}>{fmt(total)}</span></div>
                      </div>
                    </div>

                    {/* Recent invoices */}
                    <div style={{background:"#FFFFFF",border:"1px solid #E4E7EC",borderRadius:14,overflow:"hidden"}}>
                      <div style={{padding:"12px 16px",borderBottom:"1px solid #E4E7EC",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{fontSize:12,fontWeight:600,color:"#4F46E5"}}>RECENT INVOICES</div>
                        <button onClick={()=>setDraft({invoice_number:nextNum,customer:"",customer_email:"",issue_date:new Date().toISOString().slice(0,10),due_date:"",notes:"",terms:"Net 30",line_items:[emptyLine()],status:"draft"})} style={{fontSize:11,background:"transparent",border:"1px solid #D0D5DD",borderRadius:7,padding:"3px 10px",color:"#475467",cursor:"pointer"}}>+ New</button>
                      </div>
                      {sentInvoices.length===0 ? (
                        <div style={{padding:24,textAlign:"center",color:"#475467",fontSize:12}}>No invoices yet</div>
                      ) : sentInvoices.slice(0,8).map(inv=>{
                        const invTotal = inv.line_items?.reduce((s,l)=>s+(l.amount||0),0)||0;
                        return (
                          <div key={inv.id} style={{padding:"12px 16px",borderTop:"1px solid #E4E7EC",cursor:"pointer",background:"transparent"}}
                            onClick={()=>setDraft(inv)}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                              <div>
                                <div style={{fontSize:12,fontWeight:600,fontFamily:"'DM Mono',monospace",color:"#4F46E5"}}>{inv.invoice_number}</div>
                                <div style={{fontSize:11,color:"#475467",marginTop:2}}>{inv.customer}</div>
                              </div>
                              <div style={{textAlign:"right"}}>
                                <div style={{fontSize:13,fontWeight:700,fontFamily:"'DM Mono',monospace",color:inv.status==="paid"?"#039855":"#101828"}}>{fmt(invTotal)}</div>
                                <span style={{fontSize:10,background:inv.status==="paid"?"#03985522":inv.status==="draft"?"#E4E7EC":"#4F46E522",color:inv.status==="paid"?"#039855":inv.status==="draft"?"#475467":"#4F46E5",borderRadius:20,padding:"1px 7px"}}>{inv.status}</span>
                              </div>
                            </div>
                            {inv.status!=="paid" && (
                              <button onClick={e=>{e.stopPropagation();markInvoicePaid(inv);}} style={{marginTop:8,fontSize:11,padding:"4px 12px",borderRadius:7,background:"transparent",border:"1px solid #03985533",color:"#039855",cursor:"pointer"}}>Mark Paid → Collect A/R</button>
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
