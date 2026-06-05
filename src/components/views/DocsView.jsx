import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function DocsView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const preview = docsPreview; const setPreview = setDocsPreview;
            const filterType = docsFilterType; const setFilterType = setDocsFilterType;
            const types = ["all",...new Set(docLibrary.map(d=>d.type))];
            const filtered = filterType==="all"?docLibrary:docLibrary.filter(d=>d.type===filterType);
            return (
              <div>
                <div style={{marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                  <div>
                    <div style={{fontSize:10,letterSpacing:3,color:"#86868F",marginBottom:8}}>DOCUMENT LIBRARY</div>
                    <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Documents</h1>
                    <div style={{fontSize:13,color:"#86868F",marginTop:6}}>Every uploaded file — invoices, contracts, bank statements, payroll — stored and searchable. {docLibrary.length} document{docLibrary.length!==1?"s":""} stored.</div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    {types.map(t=>(
                      <button key={t} onClick={()=>setFilterType(t)} style={{padding:"6px 14px",borderRadius:20,fontSize:12,background:filterType===t?"#6D5EF6":"#1C1C20",border:"none",color:filterType===t?"#F2F2F4":"#9A9AA2",cursor:"pointer",textTransform:"capitalize"}}>{t}</button>
                    ))}
                  </div>
                </div>
                {preview && (
                  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setPreview(null)}>
                    <div style={{background:"#141416",border:"1px solid #262629",borderRadius:16,padding:24,maxWidth:700,width:"90%",maxHeight:"80vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                        <div style={{fontSize:15,fontWeight:600}}>{preview.name}</div>
                        <button onClick={()=>setPreview(null)} style={{background:"transparent",border:"none",color:"#9A9AA2",fontSize:20,cursor:"pointer"}}>×</button>
                      </div>
                      {preview.base64 && preview.mediaType?.startsWith("image") && (
                        <img src={`data:${preview.mediaType};base64,${preview.base64}`} style={{width:"100%",borderRadius:8}} alt={preview.name}/>
                      )}
                      {preview.base64 && preview.mediaType==="application/pdf" && (
                        <iframe src={`data:application/pdf;base64,${preview.base64}`} style={{width:"100%",height:500,border:"none",borderRadius:8}} title={preview.name}/>
                      )}
                      {!preview.base64 && (() => {
                        const rows = [
                          ["File name", preview.name],
                          ["Document type", preview.type],
                          ["Media type", preview.mediaType || "—"],
                          ["Uploaded", preview.uploaded_at ? new Date(preview.uploaded_at).toLocaleString() : "—"],
                          ["Tags", (preview.tags||[]).length ? preview.tags.join(", ") : "—"],
                          ["Linked entry", preview.linked_invoice_id || "—"],
                          ["Entry needed", preview.entry_needed==null ? "—" : (preview.entry_needed ? "Yes" : "No")],
                          ["Posted", preview.posted==null ? "—" : (preview.posted ? "Yes" : "No")],
                        ];
                        return (
                          <div>
                            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"28px 0 22px"}}>
                              <div style={{fontSize:40,opacity:0.5}}>{preview.mediaType==="application/pdf"?"📄":preview.mediaType?.startsWith("image")?"🖼":"📁"}</div>
                              <div style={{fontSize:13,color:"#86868F",textAlign:"center",maxWidth:420,lineHeight:1.55}}>
                                The file itself isn't stored in the database (only its metadata). Re-upload the file to preview its contents.
                              </div>
                            </div>
                            <div style={{background:"#0C0C0E",border:"1px solid #1C1C20",borderRadius:12,padding:"6px 16px"}}>
                              {rows.map(([k,v])=>(
                                <div key={k} style={{display:"flex",justifyContent:"space-between",gap:16,padding:"10px 0",borderBottom:"1px solid #161619",fontSize:13}}>
                                  <span style={{color:"#86868F"}}>{k}</span>
                                  <span style={{color:"#F2F2F4",textAlign:"right",wordBreak:"break-word",maxWidth:"70%"}}>{v}</span>
                                </div>
                              ))}
                            </div>
                            {preview.ai_explanation && (
                              <div style={{marginTop:14,background:"#0C0C0E",border:"1px solid #1C1C20",borderRadius:12,padding:"14px 16px"}}>
                                <div style={{fontSize:10,letterSpacing:1,color:"#A99CFF",marginBottom:6}}>AI EXPLANATION</div>
                                <div style={{fontSize:13,color:"#9A9AA2",lineHeight:1.6}}>{preview.ai_explanation}</div>
                              </div>
                            )}
                            {preview.entry_summary && (
                              <div style={{marginTop:14,background:"#0C0C0E",border:"1px solid #1C1C20",borderRadius:12,padding:"14px 16px"}}>
                                <div style={{fontSize:10,letterSpacing:1,color:"#86868F",marginBottom:6}}>ENTRY SUMMARY</div>
                                <div style={{fontSize:13,color:"#9A9AA2",lineHeight:1.6}}>{preview.entry_summary}</div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {preview.base64 && <div style={{marginTop:16,fontSize:12,color:"#86868F"}}>Uploaded {preview.uploaded_at?.slice(0,10)} · Type: {preview.type} · {preview.mediaType}</div>}
                    </div>
                  </div>
                )}
                {filtered.length===0 ? (
                  <div style={{background:"#141416",border:"1px solid #1C1C20",borderRadius:14,padding:48,textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:12}}>📁</div>
                    <div style={{fontSize:15,fontWeight:500,marginBottom:8}}>No documents yet</div>
                    <div style={{fontSize:13,color:"#86868F"}}>Documents are stored automatically when you upload invoices, contracts, bank statements, and payroll files.</div>
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:12}}>
                    {filtered.map(doc=>(
                      <div key={doc.id} style={{background:"#141416",border:"1px solid #1C1C20",borderRadius:12,padding:18,cursor:"pointer",transition:"border-color 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.borderColor="#C7BFFF"}
                        onMouseLeave={e=>e.currentTarget.style.borderColor="#1C1C20"}
                        onClick={()=>setPreview(doc)}>
                        <div style={{fontSize:32,marginBottom:12}}>
                          {doc.type==="invoice"?"🧾":doc.type==="contract"?"📄":doc.type==="bank_statement"?"🏦":doc.type==="payroll"?"💼":"📋"}
                        </div>
                        <div style={{fontSize:13,fontWeight:500,marginBottom:4,wordBreak:"break-word"}}>{doc.name}</div>
                        <div style={{fontSize:11,color:"#86868F",marginBottom:8}}>{doc.uploaded_at?.slice(0,10)}</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,background:"#1C1C20",color:"#9A9AA2",borderRadius:20,padding:"2px 8px",textTransform:"capitalize"}}>{doc.type}</span>
                          {(doc.tags||[]).map(t=><span key={t} style={{fontSize:10,background:"#18181C",color:"#C7BFFF",borderRadius:20,padding:"2px 8px"}}>{t}</span>)}
                        </div>
                        <div style={{marginTop:10,fontSize:11,color:"#86868F"}}>Click to preview →</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
}
