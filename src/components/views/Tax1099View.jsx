import React from "react";
import { useERP } from "../ERPContext";
import { glIsExpense } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";

const TYPE_OPTIONS = [
  { v:"individual",  label:"Individual / Sole Proprietor", exempt:false },
  { v:"smllc",       label:"Single-member LLC", exempt:false },
  { v:"partnership", label:"Partnership or Multi-member LLC", exempt:false },
  { v:"corp",        label:"Corporation (Inc, Corp, Ltd)", exempt:true },
  { v:"scorp",       label:"S-Corporation", exempt:true },
  { v:"nonprofit",   label:"Nonprofit", exempt:true },
];
const isExemptType = t => ["corp","scorp","nonprofit"].includes(t);

export default function Tax1099View() {
  const { contacts, setContacts, invoices, companySettings, persistContact, logAudit, showNotification } = useERP();

  const taxYear = new Date().getFullYear() - 1; // always the previous calendar year
  const month = new Date().getMonth(); // 0=Jan
  const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
  const yourEIN = companySettings?.taxId || companySettings?.ein || companySettings?.tax_id || "";

  const [editing, setEditing] = React.useState(null); // {name, contact, business_type, ein_ssn, mailing_address}

  // Find a contact by fuzzy name match
  const norm = s => (s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const contactFor = (name) => {
    const n = norm(name); if(!n) return null;
    return (contacts||[]).find(c => { const cn=norm(c.name); return cn && (cn===n || cn.includes(n) || n.includes(cn)); }) || null;
  };

  // Total paid to each vendor in the tax year (expense entries, not voided)
  const paidByVendor = {};
  invoices.filter(i => glIsExpense(i.gl_code) && i.status!=="voided" && (i.date||"").startsWith(String(taxYear))).forEach(i => {
    const v = i.vendor || "Unknown"; paidByVendor[v] = (paidByVendor[v]||0) + (i.amount||0);
  });
  const vendors = Object.entries(paidByVendor)
    .map(([name, paid]) => ({ name, paid, contact: contactFor(name) }))
    .filter(v => v.paid >= 1)
    .sort((a,b) => b.paid - a.paid);

  const statusOf = (v) => {
    const c = v.contact;
    const exempt = c && (c.is_1099_exempt || isExemptType(c.business_type));
    const eligible = c && ["individual","smllc","partnership","sole_prop"].includes(c.business_type);
    if (exempt) return { key:"none", label:"Not required", color:"#6B7280" };
    if (v.paid >= 600 && eligible) return c.sent_1099_2025 ? { key:"sent", label:"Sent ✓", color:"#059669" } : { key:"needs", label:"Needs 1099", color:"#DC2626" };
    if (v.paid >= 600 && (!c || !c.business_type)) return { key:"unknown", label:"Unknown", color:"#D97706" };
    if (v.paid >= 1 && v.paid < 600) return { key:"tracking", label:"Tracking", color:"#D97706" };
    return { key:"none", label:"Not required", color:"#6B7280" };
  };

  const rows = vendors.map(v => ({ ...v, status: statusOf(v) }));
  const needs = rows.filter(r => r.status.key==="needs");

  // ── Save vendor classification to the contact (create if missing) ──
  const saveVendor = () => {
    const e = editing; if(!e) return;
    const exempt = isExemptType(e.business_type);
    const existing = e.contact;
    const merged = existing
      ? { ...existing, business_type:e.business_type, ein_ssn:e.ein_ssn||existing.ein_ssn||null, mailing_address:e.mailing_address||existing.mailing_address||null, is_1099_exempt:exempt }
      : { id: Date.now()+Math.random(), name:e.name, type:"vendor", business_type:e.business_type, ein_ssn:e.ein_ssn||null, mailing_address:e.mailing_address||null, is_1099_exempt:exempt, created_at:new Date().toISOString() };
    setContacts(prev => existing ? prev.map(c => c.id===existing.id ? merged : c) : [merged, ...prev]);
    persistContact && persistContact(merged);
    logAudit && logAudit("vendor_1099_updated", `Set business type for ${e.name}: ${TYPE_OPTIONS.find(t=>t.v===e.business_type)?.label||e.business_type}`, null, { vendor:e.name, business_type:e.business_type });
    setEditing(null);
    showNotification && showNotification("Vendor saved ✓");
  };

  const markSent = (v) => {
    const c = v.contact;
    const merged = c ? { ...c, sent_1099_2025:true } : { id:Date.now()+Math.random(), name:v.name, type:"vendor", sent_1099_2025:true, business_type:"individual", created_at:new Date().toISOString() };
    setContacts(prev => c ? prev.map(x=>x.id===c.id?merged:x) : [merged, ...prev]);
    persistContact && persistContact(merged);
    logAudit && logAudit("1099_sent", `Marked 1099 as sent for ${v.name} (${taxYear})`, null, { vendor:v.name, taxYear });
    showNotification && showNotification(`Marked 1099 sent for ${v.name} ✓`);
  };

  // ── Export 1099 data CSV (for Track1099 / Tax1099) ──
  const exportCSV = (only) => {
    const list = (only ? [only] : needs);
    const head = ["Recipient Name","Business Type","SSN_or_EIN","Mailing Address",`Total Paid ${taxYear}`,"Payer (You) EIN"];
    const lines = [head];
    list.forEach(r => lines.push([
      (r.name||"").replace(/,/g," "),
      r.contact?.business_type||"",
      r.contact?.ein_ssn||"",
      (r.contact?.mailing_address||"").replace(/,/g," ").replace(/\n/g," "),
      r.paid.toFixed(2),
      yourEIN,
    ]));
    const blob = new Blob([lines.map(l=>l.join(",")).join("\n")], { type:"text/csv" });
    const u = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=u; a.download=`1099_data_${taxYear}.csv`; a.click(); URL.revokeObjectURL(u);
    showNotification && showNotification("1099 data exported ✓");
  };

  const card = { background:"#FFFFFF", border:"1px solid #E5E7EB", borderRadius:14, boxShadow:"0 1px 3px rgba(0,0,0,.08)" };
  const inp = { width:"100%", boxSizing:"border-box", background:"#FFFFFF", border:"1px solid #D1D5DB", borderRadius:9, padding:"10px 12px", fontSize:14, color:"#111827", outline:"none" };
  const lbl = { fontSize:11, color:"#6B7280", letterSpacing:0.5, marginBottom:6, fontWeight:500 };
  const pill = (c,t) => <span style={{ fontSize:11, fontWeight:600, color:c, background:c+"14", border:`1px solid ${c}33`, borderRadius:20, padding:"3px 10px", whiteSpace:"nowrap" }}>{t}</span>;

  return (
    <div>
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:10, letterSpacing:3, color:"#6B7280", marginBottom:8 }}>TAX · {taxYear}</div>
        <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>1099 contractors</h1>
      </div>

      {/* STEP 1 — education */}
      <div style={{ ...card, padding:"16px 20px", marginBottom:16, background:"#EEF2FF", borderColor:"#4F46E533" }}>
        <div style={{ fontSize:13, color:"#374151", lineHeight:1.6 }}>
          Every year, if you paid a freelancer, contractor, or unincorporated business more than <strong>$600</strong>, you're legally required to send them a <strong>Form 1099-NEC by January 31st</strong>. We track this automatically — here's where you stand for {taxYear}.
        </div>
      </div>

      {/* January due banner */}
      {(month===0 || month===11) && needs.length>0 && (
        <div style={{ ...card, padding:"14px 18px", marginBottom:16, background:"#FFFBEB", borderColor:"#D9770644", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
          <div style={{ fontSize:13, fontWeight:600, color:"#92400E" }}>⏰ 1099s are due January 31st — you have {needs.length} vendor{needs.length!==1?"s":""} who need one.</div>
          <button onClick={()=>exportCSV()} style={{ padding:"8px 16px", borderRadius:9, background:"#D97706", border:"none", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}>Export 1099 data →</button>
        </div>
      )}

      {/* Summary + export */}
      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:16, flexWrap:"wrap" }}>
        <div style={{ ...card, padding:"12px 18px", flex:"1 1 200px" }}>
          <div style={{ fontSize:11, color:"#6B7280", marginBottom:4 }}>NEED A 1099</div>
          <div style={{ fontSize:22, fontWeight:700, color:"#DC2626" }}>{needs.length}</div>
        </div>
        <div style={{ ...card, padding:"12px 18px", flex:"1 1 200px" }}>
          <div style={{ fontSize:11, color:"#6B7280", marginBottom:4 }}>YOUR EIN</div>
          <div style={{ fontSize:14, fontWeight:600, color: yourEIN?"#111827":"#DC2626" }}>{yourEIN || "Add in Settings → Company"}</div>
        </div>
        <button onClick={()=>exportCSV()} disabled={needs.length===0} style={{ padding:"11px 18px", borderRadius:10, background: needs.length?"#4F46E5":"#E5E7EB", border:"none", color: needs.length?"#fff":"#9CA3AF", fontSize:13, fontWeight:600, cursor: needs.length?"pointer":"not-allowed" }}>Export 1099 data (CSV)</button>
      </div>

      {/* STEP 2 — vendor list */}
      <div style={{ ...card, overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:"1px solid #F3F4F6", fontSize:13, fontWeight:600 }}>Vendors paid in {taxYear}</div>
        {rows.length===0 ? <div style={{ padding:"40px", textAlign:"center", color:"#6B7280", fontSize:13 }}>No vendor payments recorded for {taxYear} yet.</div> :
          rows.map(r=>{
            const c=r.contact; const st=r.status;
            const missing = st.key==="needs" ? [ !c?.ein_ssn && "SSN/EIN", !c?.mailing_address && "address", !yourEIN && "your EIN" ].filter(Boolean) : [];
            return (
              <div key={r.name} style={{ borderTop:"1px solid #F3F4F6" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"13px 18px", flexWrap:"wrap" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:11, minWidth:0 }}>
                    <span style={{ width:30, height:30, borderRadius:8, background:vendorColor(r.name), display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(r.name)}</span>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:500, color:"#111827" }}>{r.name}</div>
                      <div style={{ fontSize:11, color:"#6B7280" }}>{fmt(r.paid)} paid{c?.business_type?` · ${TYPE_OPTIONS.find(t=>t.v===c.business_type)?.label||c.business_type}`:""}</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                    {pill(st.color, st.label)}
                    {st.key==="unknown" && <button onClick={()=>setEditing({ name:r.name, contact:c, business_type:"", ein_ssn:c?.ein_ssn||"", mailing_address:c?.mailing_address||"" })} style={{ padding:"7px 13px", borderRadius:8, fontSize:12, fontWeight:600, background:"#FEF3C7", border:"1px solid #D9770644", color:"#92400E", cursor:"pointer" }}>Tell us about this vendor</button>}
                    {st.key==="needs" && <>
                      <button onClick={()=>setEditing({ name:r.name, contact:c, business_type:c?.business_type||"", ein_ssn:c?.ein_ssn||"", mailing_address:c?.mailing_address||"" })} style={{ padding:"7px 13px", borderRadius:8, fontSize:12, background:"#FFFFFF", border:"1px solid #D1D5DB", color:"#374151", cursor:"pointer" }}>Add missing info</button>
                      <button onClick={()=>exportCSV(r)} style={{ padding:"7px 13px", borderRadius:8, fontSize:12, background:"#FFFFFF", border:"1px solid #D1D5DB", color:"#374151", cursor:"pointer" }}>Export info</button>
                      <button onClick={()=>markSent(r)} style={{ padding:"7px 13px", borderRadius:8, fontSize:12, fontWeight:600, background:"#ECFDF5", border:"1px solid #05966944", color:"#059669", cursor:"pointer" }}>Mark as sent</button>
                    </>}
                  </div>
                </div>
                {/* STEP 4 — readiness checklist for needs-1099 */}
                {st.key==="needs" && (
                  <div style={{ padding:"0 18px 13px 59px", fontSize:12, color:"#6B7280", display:"flex", gap:16, flexWrap:"wrap" }}>
                    <span>To send a 1099 you need:</span>
                    <span style={{ color: c?.ein_ssn?"#059669":"#DC2626" }}>{c?.ein_ssn?"☑":"☐"} Their SSN/EIN</span>
                    <span style={{ color: c?.mailing_address?"#059669":"#DC2626" }}>{c?.mailing_address?"☑":"☐"} Their address</span>
                    <span style={{ color: yourEIN?"#059669":"#DC2626" }}>{yourEIN?"☑":"☐"} Your EIN</span>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* STEP 3 — vendor setup form (modal) */}
      {editing && (
        <div onClick={()=>setEditing(null)} style={{ position:"fixed", inset:0, zIndex:10001, background:"rgba(17,24,39,0.35)", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e=>e.stopPropagation()} className="sc-scale" style={{ ...card, padding:26, width:520, maxWidth:"94vw", maxHeight:"88vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
              <div>
                <div style={{ fontSize:10, letterSpacing:1.5, color:"#6B7280", marginBottom:6 }}>VENDOR DETAILS</div>
                <h2 style={{ fontSize:19, fontWeight:600, margin:0 }}>{editing.name}</h2>
              </div>
              <button onClick={()=>setEditing(null)} style={{ background:"none", border:"none", color:"#6B7280", fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={lbl}>WHAT TYPE OF BUSINESS IS {editing.name.toUpperCase()}?</div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {TYPE_OPTIONS.map(o=>(
                  <label key={o.v} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:9, border:`1px solid ${editing.business_type===o.v?"#4F46E5":"#E5E7EB"}`, background: editing.business_type===o.v?"#EEF2FF":"#FFFFFF", cursor:"pointer", fontSize:13 }}>
                    <input type="radio" name="btype" checked={editing.business_type===o.v} onChange={()=>setEditing(s=>({...s,business_type:o.v}))} />
                    <span style={{ flex:1 }}>{o.label}</span>
                    <span style={{ fontSize:11, color: o.exempt?"#6B7280":"#DC2626", fontWeight:600 }}>{o.exempt?"No 1099 needed":"Needs 1099 if $600+"}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={lbl}>DO YOU HAVE THEIR SSN OR EIN? (KEPT PRIVATE)</div>
              <input value={editing.ein_ssn} onChange={e=>setEditing(s=>({...s,ein_ssn:e.target.value}))} placeholder="e.g. 12-3456789 or 123-45-6789 — leave blank if you don't have it yet" style={inp} />
            </div>
            <div style={{ marginBottom:18 }}>
              <div style={lbl}>THEIR MAILING ADDRESS (FOR SENDING THE FORM)</div>
              <textarea value={editing.mailing_address} onChange={e=>setEditing(s=>({...s,mailing_address:e.target.value}))} placeholder="Street, City, State ZIP" rows={2} style={{ ...inp, resize:"vertical" }} />
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button disabled={!editing.business_type} onClick={saveVendor} style={{ flex:1, padding:"12px", borderRadius:10, border:"none", fontSize:14, fontWeight:600, cursor: editing.business_type?"pointer":"not-allowed", background: editing.business_type?"#4F46E5":"#E5E7EB", color: editing.business_type?"#fff":"#9CA3AF" }}>Save</button>
              <button onClick={()=>setEditing(null)} style={{ padding:"12px 18px", borderRadius:10, background:"#FFFFFF", border:"1px solid #D1D5DB", color:"#374151", fontSize:14, cursor:"pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
