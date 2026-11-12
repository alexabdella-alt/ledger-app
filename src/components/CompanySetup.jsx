import React from "react";
import { plainWriteError } from "../lib/plainWriteError";
import { supabase } from "../lib/supabase";
import { companySetupCopy, COMPANY_NAME_PLACEHOLDER } from "../lib/firstRun";

function CompanySetup({ session, onComplete, first = true, onCancel = null, onSignOut = null }) {
  const copy = companySetupCopy({ first });
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  // C419 — every step after `create_company` was fired and forgotten. A failed seed (the
  // exact thing O108's unrun check (c) worried about after `069`) left a company with NO
  // chart: the owner landed on Home with the built-in chart shown as theirs, and the first
  // booking would have materialised every account with no system_role — every role lookup
  // falling back forever. Each step is checked now, the seed is verified by reading it
  // back, and a retry after a failure resumes from the step that failed rather than
  // creating a SECOND company.
  const createdRef = React.useRef(null);
  const create = async () => {
    if (!name.trim()) return;
    setLoading(true); setError(null);
    try {
      let company = createdRef.current;
      if (!company) {
        // Create company + owner membership atomically (RLS-compatible).
        // create_company() is SECURITY DEFINER and inserts the company_users
        // owner row in the same transaction, so the caller can read it back.
        const { data, error: ce } = await supabase.rpc("create_company", { p_name: name.trim() });
        if (ce) throw ce;
        if (!data?.id) throw new Error("We couldn't create the company — nothing was set up. Please try again.");
        company = data; createdRef.current = data;
      }
      // Seed chart of accounts — and READ IT BACK, because the RPC returning without an
      // error and the chart existing are two different facts.
      const { count: haveAccounts } = await supabase.from("accounts").select("id", { count: "exact", head: true }).eq("company_id", company.id);
      if (!haveAccounts) {
        const { error: se } = await supabase.rpc("seed_company_accounts", { p_company_id: company.id });
        if (se) throw new Error(`The company was created but its categories couldn't be set up — press Create again to retry. ${plainWriteError(se.message)}`.trim());
        const { count: seeded } = await supabase.from("accounts").select("id", { count: "exact", head: true }).eq("company_id", company.id);
        if (!seeded) throw new Error("The company was created but its categories didn't appear — press Create again to retry.");
      }
      // Create default bank account (once)
      const { data: cashAcct } = await supabase.from("accounts")
        .select("id").eq("company_id", company.id).eq("code", "1000").maybeSingle();
      const { count: haveBank } = await supabase.from("bank_accounts").select("id", { count: "exact", head: true }).eq("company_id", company.id);
      if (cashAcct && !haveBank) {
        const { error: be } = await supabase.from("bank_accounts").insert({
          company_id: company.id, name: "Primary Checking",
          type: "checking", gl_account_id: cashAcct.id
        }).select("id");
        if (be) throw new Error(`The company and its categories are set up, but the starting bank account couldn't be added — press Create again to retry. ${plainWriteError(be.message)}`.trim());
      }
      // Stub subscription (once)
      const { count: haveSub } = await supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("company_id", company.id);
      if (!haveSub) {
        const { error: sube } = await supabase.from("subscriptions").insert({
          company_id: company.id, plan: "trial", status: "trialing",
          trial_ends_at: new Date(Date.now() + 14*24*60*60*1000).toISOString()
        }).select("id");
        if (sube) throw new Error(`Nearly there — the trial couldn't be started — press Create again to retry. ${plainWriteError(sube.message)}`.trim());
      }
      onComplete(company);
    } catch(e) { console.error("[company setup]", e?.message || e); setError(e.message); setLoading(false); }
  };

  const s = {
    wrap: { minHeight:"100vh", background:"var(--sc-bg)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif", padding:16, boxSizing:"border-box" },
    // C583 — a fixed 440px card ran off the side of a phone.
    card: { background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:20, padding:"clamp(24px, 6vw, 40px)", width:"100%", maxWidth:440, boxSizing:"border-box", boxShadow:"0 24px 80px rgba(0,0,0,0.7)" },
    h1: { fontSize:24, fontWeight:700, color:"var(--sc-text)", margin:"0 0 8px", letterSpacing:-0.5 },
    sub: { fontSize:13, color:"var(--sc-text-2)", marginBottom:28 },
    label: { fontSize:11, color:"var(--sc-text-2)", marginBottom:4, letterSpacing:0.5 },
    input: { width:"100%", boxSizing:"border-box", background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", borderRadius:10, padding:"12px 14px", color:"var(--sc-text)", fontSize:15, outline:"none", marginBottom:20 },
    btn: { width:"100%", padding:"13px", borderRadius:10, fontSize:14, fontWeight:600, background:name.trim()?"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))":"var(--sc-border)", border:"none", color:"var(--sc-text)", cursor:name.trim()?"pointer":"not-allowed" },
    error: { background:"var(--sc-error-soft)", border:"1px solid var(--sc-error-soft)", borderRadius:8, padding:"10px 14px", fontSize:13, color:"var(--sc-error)", marginBottom:12 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.h1}>{copy.title}</div>
        <div style={s.sub}>{copy.sub}</div>
        {error && <div style={s.error}>{error}</div>}
        <div style={s.label}>BUSINESS NAME</div>
        <input style={s.input} value={name} onChange={e=>setName(e.target.value)}
          placeholder={COMPANY_NAME_PLACEHOLDER} autoFocus autoComplete="organization" onKeyDown={e=>e.key==="Enter"&&create()}/>
        <button style={s.btn} onClick={create} disabled={loading||!name.trim()}>
          {loading ? copy.busy : copy.button}
        </button>
        {/* C583 — two ways off this screen that did not exist: back to the business you were in
            (it opened from "New company" with no way out but creating one), and out of an
            account you did not mean to sign in to. */}
        {onCancel && !loading && (
          <button data-setup-cancel onClick={onCancel} style={{ width:"100%", marginTop:10, padding:"11px", borderRadius:10, fontSize:13, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }}>← Back to your books</button>
        )}
        {onSignOut && !loading && (
          <div data-setup-signout style={{ marginTop:18, fontSize:12, color:"var(--sc-text-mut)", textAlign:"center" }}>
            Signed in as {session?.user?.email || "your account"}. Not you?{" "}
            <span onClick={onSignOut} style={{ color:"var(--sc-gold)", cursor:"pointer", fontWeight:500 }}>Sign out</span>
          </div>
        )}
      </div>
    </div>
  );
}


export default CompanySetup;
