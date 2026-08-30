import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, todayLocal } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { buildCompanyUpdate } from "../../lib/writeShapes";
import { glCodeForAccountType } from "../../lib/bankAccounts";

export default function SettingsView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, setCompanies, setCurrentCompany, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, glBreakdown, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, persistBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setLegalTab, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const draft = settingsDraft || companySettings; const setDraft = setSettingsDraft;
            const saved = settingsSaved; const setSaved = setSettingsSaved;
            const logoPreview = settingsLogoPreview ?? companySettings.logoBase64; const setLogoPreview = setSettingsLogoPreview;
            const save = async () => {
              setCompanySettings(draft);
              persistBankAccounts && persistBankAccounts(); // save bank accounts incl. balances
              // Persist ALL company identity/accounting fields to the companies table —
              // not just sales_tax_rate (they were lost on refresh before). All columns
              // exist (no migration); the logo is intentionally excluded (see writeShapes).
              if (currentCompany?.id) {
                const companyPatch = buildCompanyUpdate(draft);
                try {
                  // ★★ `.select("id")` IS THE POINT, NOT DECORATION. PostgREST reports NO error
                  // for an update that matched zero rows, so `if (error)` alone passes a write
                  // that changed nothing — and the two `set…` calls below then paint the new
                  // values on screen, so the save LOOKS done and the next reload throws it away.
                  // That is the O76 "screen doesn't refresh" complaint from the writing end:
                  // the screen was right and the database never agreed.
                  //
                  // ▶ NOT `checkedRowUpdate`: that helper scopes every write by `company_id`,
                  // and `companies` is keyed by `id` — it has no `company_id` column. Using it
                  // here would match nothing and fail every save.
                  const { data, error } = await supabase.from("companies").update(companyPatch).eq("id", currentCompany.id).select("id");
                  if (error || !data || !data.length) {
                    console.error("[settings] save failed:", error?.message || "no rows updated");
                    showNotification("Couldn't save settings — nothing was changed. Please try again.", "error");
                    return;
                  }
                } catch (e) { console.warn("[settings] save:", e?.message || e); showNotification("Couldn't save settings — please try again", "error"); return; }
                // O75 self-identity aliases — separate guarded write so a pre-migration
                // (no `aliases` column) degrades silently without failing the whole save.
                // ▶ DELIBERATELY NON-BLOCKING, and now deliberately OBSERVABLE. The point of
                // the separate write is that a database without the `aliases` column (pre-`046`)
                // should not fail the whole save — but "we tolerate a missing column" had become
                // "we cannot tell whether this ever saved", which is a different thing. It now
                // reports, and does not block.
                try {
                  const { data, error } = await supabase.from("companies")
                    .update({ aliases: draft.aliases || null }).eq("id", currentCompany.id).select("id");
                  if (error || !data || !data.length) console.warn("[settings] aliases not persisted (apply migration 046):", error?.message || "no rows updated");
                } catch (e) { console.warn("[settings] aliases not persisted (apply migration 046):", e?.message || e); }
                // O76 display-sync: update the in-memory company so the top-nav header/wordmark
                // (and anything reading currentCompany) reflects the new name/identity LIVE —
                // not only after a refresh. The DB write above is the source of truth; this keeps
                // the read-model in sync, the consistent "re-sync on mutation" discipline.
                setCurrentCompany && setCurrentCompany(prev => prev && prev.id === currentCompany.id ? { ...prev, ...companyPatch } : prev);
                setCompanies && setCompanies(prev => (prev || []).map(c => c.id === currentCompany.id ? { ...c, ...companyPatch } : c));
              }
              logAudit("settings_saved", `Company settings updated: ${draft.name}`);
              setSaved(true); setTimeout(()=>setSaved(false), 2000);
            };
            const handleLogo = (file) => {
              if (!file) return;
              // O62: the logo persists as a base64 data URL in companies.logo_path. Cap the
              // file size so the row stays sane (base64 inflates ~33%); for anything larger a
              // Storage bucket is the right home (future). ~750KB source → ~1MB stored.
              if (file.size > 768 * 1024) { showNotification("Logo is too large — please use an image under 750 KB.", "error"); return; }
              if (!/^image\//.test(file.type || "")) { showNotification("Please choose an image file for the logo.", "error"); return; }
              const r = new FileReader();
              r.onload = e => { const b64 = e.target.result; setLogoPreview(b64); setDraft(d=>({...d, logoBase64:b64})); };
              r.readAsDataURL(file);
            };
            // ── Export all data (CSV safety net) ──
            const downloadCSV = (filename, rows) => {
              const esc = v => { if (v==null) return ""; const s=String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
              const csv = rows.map(r => r.map(esc).join(",")).join("\n");
              const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
              URL.revokeObjectURL(url);
            };
            const exportAllData = () => {
              const stamp = todayLocal();
              const co = (currentCompany?.name || "company").replace(/[^a-z0-9]+/gi, "_");
              const txnRows = [["Date","Vendor","Description","GL Code","GL Account","Type","Amount","Status","Payment Status","Project"]];
              (invoices||[]).forEach(i => txnRows.push([i.date, i.vendor, i.description, i.gl_code, i.gl_name, i.type, i.amount, i.status, i.payment_status, i.project]));
              downloadCSV(`${co}_transactions_${stamp}.csv`, txnRows);
              const contactRows = [["Name","Type","Email","Phone","Website","Payment Terms","Tax ID","Tags","Notes"]];
              (contacts||[]).forEach(c => contactRows.push([c.name, c.type, c.email, c.phone, c.website, c.payment_terms, c.tax_id||c.ein||c.ein_ssn, (c.tags||[]).join("; "), c.notes]));
              downloadCSV(`${co}_contacts_${stamp}.csv`, contactRows);
              const contractRows = [["Counterparty","Type","Description","Monthly Payment","Frequency","Term (months)","Start","End","Total Value","Treatment"]];
              (contracts||[]).forEach(c => contractRows.push([c.counterparty, c.contract_type, c.description, c.payment_amount, c.payment_frequency, c.lease_term_months, c.start_date, c.end_date, c.total_value, c.accounting_treatment]));
              downloadCSV(`${co}_contracts_${stamp}.csv`, contractRows);
              logAudit("data_export", `Exported all data: ${(invoices||[]).length} transactions, ${(contacts||[]).length} contacts, ${(contracts||[]).length} contracts`);
              showNotification("Exported transactions, contacts & contracts ✓");
            };
            const inp = (k,l,p,type="text") => (
              <div>
                <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>{l}</div>
                <input type={type} value={draft[k]||""} onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))} placeholder={p}
                  style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"9px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}/>
              </div>
            );
            return (
              <div style={{maxWidth:720}}>
                <div style={{marginBottom:28}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"var(--sc-text-2)",marginBottom:8}}>CONFIGURATION</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Settings</h1>
                </div>

                {/* Company identity */}
                <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,padding:24,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:600,color:"var(--sc-gold)",letterSpacing:0.5,marginBottom:16}}>COMPANY</div>
                  <div style={{display:"flex",gap:16,marginBottom:16,alignItems:"flex-start"}}>
                    {/* Logo */}
                    <div style={{flexShrink:0}}>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:6}}>LOGO</div>
                      <div onClick={()=>{const i=document.createElement("input");i.type="file";i.accept="image/*";i.onchange=e=>handleLogo(e.target.files[0]);i.click();}}
                        style={{width:80,height:80,borderRadius:12,border:"2px dashed var(--sc-border-2)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",background:"var(--sc-surface-2)"}}>
                        {logoPreview ? <img src={logoPreview} style={{width:"100%",height:"100%",objectFit:"contain"}} alt="logo"/> : <span style={{fontSize:24}}>🏢</span>}
                      </div>
                    </div>
                    <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      {inp("name","Company Name","Acme Corp")}
                      {inp("taxId","EIN / Tax ID","XX-XXXXXXX")}
                    </div>
                  </div>
                  {/* O75 — self-identity: used to tell YOUR outgoing invoices (revenue) from
                      vendor bills you received (expense). Same PDF, opposite meaning. */}
                  <div style={{marginBottom:16}}>
                    {inp("aliases","Also known as / DBA","Northwind, Northwind Studio LLC")}
                    <div style={{fontSize:11,color:"var(--sc-text-mut)",marginTop:5}}>Any other names you invoice under (comma-separated). Used to recognize <strong>your own</strong> invoices as revenue and bills addressed to you as expenses.</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:12}}>
                    {inp("address","Street Address","123 Main St")}
                    {inp("city","City","Austin")}
                    {inp("state","State","TX")}
                    {inp("zip","ZIP","78701")}
                  </div>
                </div>

                {/* Accounting settings */}
                <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,padding:24,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:600,color:"var(--sc-gold)",letterSpacing:0.5,marginBottom:16}}>ACCOUNTING</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                    <div>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>FISCAL YEAR END</div>
                      <select value={draft.fiscalYearEnd} onChange={e=>setDraft(d=>({...d,fiscalYearEnd:e.target.value}))}
                        style={{width:"100%",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"9px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}>
                        {[["12-31","December 31"],["03-31","March 31"],["06-30","June 30"],["09-30","September 30"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>DEFAULT CASH ACCOUNT</div>
                      <select value={draft.defaultCashAccount} onChange={e=>setDraft(d=>({...d,defaultCashAccount:e.target.value}))}
                        style={{width:"100%",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"9px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}>
                        {CHART_OF_ACCOUNTS.filter(a=>a.category==="Assets").map(a=><option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>CURRENCY</div>
                      <select value={draft.currency||"USD"} onChange={e=>setDraft(d=>({...d,currency:e.target.value}))}
                        style={{width:"100%",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"9px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}>
                        {["USD","EUR","GBP","CAD","AUD"].map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>DEFAULT SALES TAX RATE</div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <input type="number" min="0" step="0.01" value={draft.salesTaxRate ?? 0} onChange={e=>setDraft(d=>({...d,salesTaxRate:e.target.value}))}
                          style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"9px 12px",color:"var(--sc-text)",fontSize:13,outline:"none"}}/>
                        <span style={{fontSize:13,color:"var(--sc-text-2)"}}>%</span>
                      </div>
                      <div style={{fontSize:11,color:"var(--sc-text-mut)",marginTop:4}}>Pre-fills new invoices · overridable per invoice</div>
                    </div>
                  </div>
                </div>

                {/* Bank accounts */}
                <div id="bank-accounts-section" style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,padding:24,marginBottom:16,scrollMarginTop:16}}>
                  <div style={{fontSize:12,fontWeight:600,color:"var(--sc-gold)",letterSpacing:0.5,marginBottom:16}}>BANK ACCOUNTS</div>
                  <div style={{display:"grid",gridTemplateColumns:"2fr 0.9fr 0.8fr 1.3fr 1.2fr auto",gap:10,marginBottom:6,fontSize:10,fontWeight:600,letterSpacing:0.4,color:"var(--sc-text-mut)"}}>
                    <div>ACCOUNT NAME</div><div>TYPE</div><div>GL</div><div>BANK</div><div style={{textAlign:"right"}}>CURRENT BALANCE</div><div/>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:12}}>
                    {bankAccounts.map(ba=>(
                      <div key={ba.id} style={{display:"grid",gridTemplateColumns:"2fr 0.9fr 0.8fr 1.3fr 1.2fr auto",gap:10,alignItems:"center"}}>
                        <input value={ba.name} onChange={e=>setBankAccounts(prev=>prev.map(b=>b.id===ba.id?{...b,name:e.target.value}:b))}
                          placeholder="Account name" style={{background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none"}}/>
                        <select value={ba.type} onChange={e=>{
                            const type = e.target.value;
                            // Default the GL to the type's natural account so a card offsets to
                            // Credit Card Liability (2200), not Cash. (Still overridable at right.)
                            const glForType = glCodeForAccountType(type, role=>getAccountByRole(role)?.code);
                            setBankAccounts(prev=>prev.map(b=>b.id===ba.id?{...b,type,gl_code:glForType}:b));
                          }}
                          style={{background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none"}}>
                          {["checking","savings","credit_card","loan","other"].map(t=><option key={t} value={t}>{t.replace("_"," ")}</option>)}
                        </select>
                        <select value={ba.gl_code} onChange={e=>setBankAccounts(prev=>prev.map(b=>b.id===ba.id?{...b,gl_code:e.target.value}:b))}
                          style={{background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none"}}>
                          {CHART_OF_ACCOUNTS.filter(a=>["Assets","Liabilities"].includes(a.category)).map(a=><option key={a.code} value={a.code}>{a.code}</option>)}
                        </select>
                        <input value={ba.institution||""} onChange={e=>setBankAccounts(prev=>prev.map(b=>b.id===ba.id?{...b,institution:e.target.value}:b))}
                          placeholder="Bank name" style={{background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none"}}/>
                        <div style={{position:"relative"}}>
                          <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"var(--sc-text-mut)",fontSize:12,pointerEvents:"none"}}>$</span>
                          <input type="number" inputMode="decimal" step="0.01" value={ba.current_balance ?? ""}
                            onChange={e=>setBankAccounts(prev=>prev.map(b=>b.id===ba.id?{...b,current_balance:e.target.value}:b))}
                            onBlur={()=>persistBankAccounts && persistBankAccounts()}
                            placeholder="0.00" style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px 8px 18px",color:"var(--sc-text)",fontSize:12,outline:"none",fontFamily:"'DM Mono',monospace",textAlign:"right"}}/>
                        </div>
                        <button onClick={()=>setBankAccounts(prev=>prev.filter(b=>b.id!==ba.id))} style={{background:"transparent",border:"1px solid var(--sc-border-2)",borderRadius:7,padding:"7px 10px",color:"var(--sc-error)",cursor:"pointer",fontSize:13}}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,paddingTop:10,borderTop:"1px solid var(--sc-surface-2)"}}>
                    <div style={{fontSize:12,color:"var(--sc-text-2)"}}>Total cash across accounts</div>
                    <div style={{fontSize:14,fontWeight:700,fontFamily:"'DM Mono',monospace",color:"var(--sc-success)"}}>${bankAccounts.reduce((s,b)=>s+(parseFloat(b.current_balance)||0),0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                  </div>
                  <button onClick={()=>setBankAccounts(prev=>[...prev,{id:Date.now()+Math.random(),name:"",type:"checking",gl_code:getAccountByRole("cash")?.code,institution:"",current_balance:0}])}
                    style={{fontSize:12,background:"transparent",border:"1px dashed var(--sc-border-2)",borderRadius:8,padding:"7px 16px",color:"var(--sc-text-2)",cursor:"pointer"}}>+ Add Bank Account</button>
                </div>

                {/* EXPORT YOUR DATA — safety net */}
                <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,padding:20,marginBottom:24}}>
                  <div style={{fontSize:12,fontWeight:600,color:"var(--sc-gold)",letterSpacing:0.5,marginBottom:6}}>YOUR DATA</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                    <div style={{fontSize:13,color:"var(--sc-text-2)",maxWidth:440,lineHeight:1.5}}>
                      Download a CSV of every transaction, contact, and contract. Your data is always yours — keep a copy anytime.
                    </div>
                    <button onClick={exportAllData}
                      style={{flexShrink:0,height:40,padding:"0 18px",borderRadius:8,fontSize:14,fontWeight:600,background:"var(--sc-surface)",border:"1px solid var(--sc-border-2)",color:"var(--sc-text-2)",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:8}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--sc-gold)";e.currentTarget.style.color="var(--sc-gold)";}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--sc-border-2)";e.currentTarget.style.color="var(--sc-text-2)";}}>
                      ↓ Export All Data (CSV)
                    </button>
                  </div>
                </div>

                <button onClick={save} style={{padding:"11px 32px",borderRadius:10,fontSize:14,fontWeight:600,background:saved?"linear-gradient(135deg,var(--sc-success-soft),var(--sc-success))":"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))",border:"none",color:saved?"var(--sc-success)":"var(--sc-text)",cursor:"pointer",transition:"all 0.3s"}}>
                  {saved ? "✓ Saved" : "Save Settings"}
                </button>

                {/* Legal footer (Item 18) */}
                <div style={{marginTop:32,paddingTop:18,borderTop:"1px solid var(--sc-border)",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{fontSize:12,color:"var(--sc-text-mut)"}}>Shadow</span>
                  <span style={{fontSize:12,color:"var(--sc-gold)",cursor:"pointer",fontWeight:500}} onClick={()=>{ setLegalTab("terms"); setView("legal"); }}>Terms of Service</span>
                  <span style={{color:"var(--sc-border-2)"}}>·</span>
                  <span style={{fontSize:12,color:"var(--sc-gold)",cursor:"pointer",fontWeight:500}} onClick={()=>{ setLegalTab("privacy"); setView("legal"); }}>Privacy Policy</span>
                </div>
              </div>
            );
}
