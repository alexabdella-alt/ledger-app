import React from "react";
import { supabase } from "../lib/supabase";

function CompanySetup({ session, onComplete }) {
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const create = async () => {
    if (!name.trim()) return;
    setLoading(true); setError(null);
    try {
      // Create company + owner membership atomically (RLS-compatible).
      // create_company() is SECURITY DEFINER and inserts the company_users
      // owner row in the same transaction, so the caller can read it back.
      const { data: company, error: ce } = await supabase
        .rpc("create_company", { p_name: name.trim() });
      if (ce) throw ce;
      if (!company?.id) throw new Error("Company creation failed — no company returned.");
      // Seed chart of accounts
      await supabase.rpc("seed_company_accounts", { p_company_id: company.id });
      // Create default bank account
      const { data: cashAcct } = await supabase.from("accounts")
        .select("id").eq("company_id", company.id).eq("code", "1000").single();
      if (cashAcct) {
        await supabase.from("bank_accounts").insert({
          company_id: company.id, name: "Primary Checking",
          type: "checking", gl_account_id: cashAcct.id
        });
      }
      // Stub subscription
      await supabase.from("subscriptions").insert({
        company_id: company.id, plan: "trial", status: "trialing",
        trial_ends_at: new Date(Date.now() + 14*24*60*60*1000).toISOString()
      });
      onComplete(company);
    } catch(e) { setError(e.message); setLoading(false); }
  };

  const s = {
    wrap: { minHeight:"100vh", background:"#F8F9FB", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif" },
    card: { background:"#FFFFFF", border:"1px solid #D1D5DB", borderRadius:20, padding:40, width:440, boxShadow:"0 24px 80px rgba(0,0,0,0.7)" },
    h1: { fontSize:24, fontWeight:700, color:"#111827", margin:"0 0 8px", letterSpacing:-0.5 },
    sub: { fontSize:13, color:"#6B7280", marginBottom:28 },
    label: { fontSize:11, color:"#6B7280", marginBottom:4, letterSpacing:0.5 },
    input: { width:"100%", boxSizing:"border-box", background:"#F3F4F6", border:"1px solid #D1D5DB", borderRadius:10, padding:"12px 14px", color:"#111827", fontSize:15, outline:"none", marginBottom:20 },
    btn: { width:"100%", padding:"13px", borderRadius:10, fontSize:14, fontWeight:600, background:name.trim()?"linear-gradient(135deg,#4F46E5,#4338CA)":"#E5E7EB", border:"none", color:"#111827", cursor:name.trim()?"pointer":"not-allowed" },
    error: { background:"#FEF2F2", border:"1px solid #DC262633", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#DC2626", marginBottom:12 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.h1}>Create your company</div>
        <div style={s.sub}>You can add more companies later and switch between them.</div>
        {error && <div style={s.error}>{error}</div>}
        <div style={s.label}>COMPANY NAME</div>
        <input style={s.input} value={name} onChange={e=>setName(e.target.value)}
          placeholder="Acme Corp" autoFocus onKeyDown={e=>e.key==="Enter"&&create()}/>
        <button style={s.btn} onClick={create} disabled={loading||!name.trim()}>
          {loading ? "Setting up..." : "Create Company →"}
        </button>
      </div>
    </div>
  );
}


export default CompanySetup;
