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
    wrap: { minHeight:"100vh", background:"#0A0A0F", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif" },
    card: { background:"#14141A", border:"1px solid #2A2A3E", borderRadius:20, padding:40, width:440, boxShadow:"0 24px 80px rgba(0,0,0,0.7)" },
    h1: { fontSize:24, fontWeight:700, color:"#E8E8F0", margin:"0 0 8px", letterSpacing:-0.5 },
    sub: { fontSize:13, color:"#6B6B8A", marginBottom:28 },
    label: { fontSize:11, color:"#6B6B8A", marginBottom:4, letterSpacing:0.5 },
    input: { width:"100%", boxSizing:"border-box", background:"#0F0F13", border:"1px solid #2A2A3E", borderRadius:10, padding:"12px 14px", color:"#E8E8F0", fontSize:15, outline:"none", marginBottom:20 },
    btn: { width:"100%", padding:"13px", borderRadius:10, fontSize:14, fontWeight:600, background:name.trim()?"linear-gradient(135deg,#6D28D9,#4C1D95)":"#1E1E2E", border:"none", color:"#E8E8F0", cursor:name.trim()?"pointer":"not-allowed" },
    error: { background:"#2A0A0A", border:"1px solid #EF444433", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#EF4444", marginBottom:12 },
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
