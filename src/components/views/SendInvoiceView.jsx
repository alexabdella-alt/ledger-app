import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function SendInvoiceView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
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

            const saveDraft = () => {
              const inv = {...draft, id: draft.id||Date.now()+Math.random(), updated_at:new Date().toISOString()};
              if (!inv.created_at) inv.created_at = new Date().toISOString();
              setSentInvoices(prev => {
                const exists = prev.findIndex(i=>i.id===inv.id);
                if (exists>=0){const u=[...prev];u[exists]=inv;return u;}
                return [inv,...prev];
              });
              setSentInvoiceDraft(inv);
              logAudit("invoice_created",`Invoice ${inv.invoice_number} created for ${inv.customer} ${fmt(total)}`);
              showNotification(`Invoice ${inv.invoice_number} saved ✓`);
            };

            const downloadPDF = () => {
              // Build a clean HTML invoice and open print dialog
              const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${draft.invoice_number}</title>
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
    <div class="company">${companySettings.name||"Your Company"}</div>
    <div style="margin-top:4px;color:#666">${companySettings.address||""} ${companySettings.city||""} ${companySettings.state||""}</div>
    <div style="color:#666">${companySettings.taxId?"EIN: "+companySettings.taxId:""}</div>
  </div>
  <div class="invoice-meta">
    <div class="invoice-number">${draft.invoice_number}</div>
    <div style="margin-top:8px"><strong>Bill To:</strong> ${draft.customer}</div>
    <div style="color:#666">${draft.customer_email||""}</div>
    <div style="margin-top:8px">Issue Date: ${draft.issue_date}</div>
    <div>Due Date: ${draft.due_date||"On Receipt"}</div>
    <div>Terms: ${draft.terms||"Net 30"}</div>
  </div>
</div>
<table>
  <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>
    ${draft.line_items.map(l=>`<tr><td>${l.description||""}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">$${parseFloat(l.rate||0).toFixed(2)}</td><td style="text-align:right">$${(l.amount||0).toFixed(2)}</td></tr>`).join("")}
  </tbody>
</table>
<div class="totals">
  <div class="total-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
  <div class="total-row grand-total"><span>Total Due</span><span>$${total.toFixed(2)}</span></div>
</div>
${draft.notes?`<div class="footer">Notes: ${draft.notes}</div>`:""}
</body></html>`;
              const w = window.open("","_blank");
              w.document.write(html);
              w.document.close();
              w.print();
              logAudit("invoice_printed",`Invoice ${draft.invoice_number} printed/PDF'd`);
            };

            const markPaid = (inv) => {
              setSentInvoices(prev=>prev.map(i=>i.id===inv.id?{...i,status:"paid",paid_at:new Date().toISOString()}:i));
              // Also book as revenue
              const entry = {
                id:Date.now()+Math.random(), vendor:inv.customer, description:`Payment received – ${inv.invoice_number}`,
                amount:inv.line_items.reduce((s,l)=>s+(l.amount||0),0), date:new Date().toISOString().slice(0,10),
                type:"revenue", gl_code:getAccountByRole("product_revenue")?.code, gl_name:getAccountByRole("product_revenue")?.name,
                secondary_gl_code:getAccountByRole("cash")?.code, secondary_gl_name:getAccountByRole("cash")?.name,
                debit_credit:"credit", confidence:100, reasoning:`Invoice ${inv.invoice_number} paid`,
                status:"booked", booked_at:new Date().toISOString(), source:"sent_invoice", payment_status:"collected"
              };
              setInvoices(prev=>[entry,...prev]);
              logAudit("invoice_paid",`Invoice ${inv.invoice_number} marked paid – ${fmt(entry.amount)}`);
              showNotification(`${inv.invoice_number} marked paid – revenue booked ✓`);
            };

            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#475467",marginBottom:8}}>ACCOUNTS RECEIVABLE</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Send Invoice</h1>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 380px",gap:20,alignItems:"flex-start"}}>
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

                    <div style={{display:"flex",gap:10}}>
                      <button onClick={saveDraft} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,#4F46E5,#4338CA)",border:"none",color:"#fff",cursor:"pointer"}}>Save Draft</button>
                      <button onClick={downloadPDF} style={{padding:"9px 22px",borderRadius:9,fontSize:13,background:"#E4E7EC",border:"1px solid #D0D5DD",color:"#4F46E5",cursor:"pointer"}}>Download / Print PDF</button>
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
                              <button onClick={e=>{e.stopPropagation();markPaid(inv);}} style={{marginTop:8,fontSize:11,padding:"4px 12px",borderRadius:7,background:"transparent",border:"1px solid #03985533",color:"#039855",cursor:"pointer"}}>Mark Paid → Book Revenue</button>
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
