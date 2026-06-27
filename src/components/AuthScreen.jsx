import React from "react";
import { supabase } from "../lib/supabase";
import LegalView from "./LegalView";

// Shadow eclipse mark — a luminous disc partly occluded by shadow.
function EclipseMark({ size = 40 }) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f6cb5b" />
          <stop offset="100%" stopColor="#e8b53d" />
        </linearGradient>
        <radialGradient id={`r${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e8b53d" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#e8b53d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill={`url(#r${id})`} />
      <circle cx="24" cy="24" r="13" fill={`url(#g${id})`} />
      <circle cx="30.5" cy="20.5" r="11" fill="#223040" />
    </svg>
  );
}

function AuthScreen({ onAuth, invite }) {
  const inviteValid = invite && !invite.invalid && !invite.error && invite.status === "pending" && !invite.expired;
  const [mode, setMode] = React.useState(inviteValid ? "signup" : "login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [message, setMessage] = React.useState(null);
  const [legal, setLegal] = React.useState(null); // "terms" | "privacy" | null

  // Legal pages reachable before login.
  if (legal) return <LegalView initialTab={legal} onBack={()=>setLegal(null)} />;

  const handle = async () => {
    setLoading(true); setError(null); setMessage(null);
    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.session);
      } else if (mode === "reset") {
        if (!email.trim()) throw new Error("Enter your email address first.");
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        // Generic wording avoids confirming whether an account exists.
        setMessage("If an account exists for that email, a password reset link is on its way. Check your inbox (and spam).");
      } else {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name } }
        });
        if (error) throw error;
        if (data.session) onAuth(data.session);
        else setMessage("Check your email to confirm your account, then log in.");
      }
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  const label = { fontSize:11, color:"var(--sc-text-2)", marginBottom:6, letterSpacing:1, fontWeight:500 };
  const input = { width:"100%", boxSizing:"border-box", background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", borderRadius:11, padding:"12px 14px", color:"var(--sc-text)", fontSize:14, outline:"none", marginBottom:14, transition:"border-color .2s, box-shadow .2s", fontFamily:"'DM Sans', sans-serif" };

  const features = [
    ["Autonomous bookkeeping", "Drop any document — invoices, contracts, statements. It codes the GL, books the entry, and explains why."],
    ["A CFO that never sleeps", "Ask for burn rate, runway, or a P&L in plain English and get an answer grounded in your real ledger."],
    ["Audit-ready by default", "ASC 842 leases, full journal trails, and a tamper-evident audit log baked in from day one."],
  ];

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexWrap:"wrap", fontFamily:"'DM Sans', system-ui, sans-serif", color:"var(--sc-text)", position:"relative", overflow:"hidden" }}>
      {/* ── Left: brand hero ── */}
      <div style={{ flex:"1 1 460px", minWidth:0, padding:"clamp(40px, 6vw, 96px)", display:"flex", flexDirection:"column", justifyContent:"space-between", gap:48, position:"relative" }}>
        <div className="sc-rise" style={{ display:"flex", alignItems:"center", gap:14 }}>
          <span className="sc-float"><EclipseMark size={44} /></span>
          <div>
            <div className="sc-wordmark" style={{ fontSize:22, fontWeight:700, letterSpacing:3, fontFamily:"'Space Grotesk','DM Sans',sans-serif" }}>SHADOW CFO</div>
            <div style={{ fontSize:11, color:"var(--sc-text-2)", letterSpacing:2, marginTop:2 }}>AUTONOMOUS FINANCE</div>
          </div>
        </div>

        <div style={{ maxWidth:540 }}>
          <h1 className="sc-rise-1" style={{ fontSize:"clamp(34px, 4.4vw, 56px)", lineHeight:1.05, fontWeight:700, margin:"0 0 20px", letterSpacing:-1.5, fontFamily:"'Space Grotesk','DM Sans',sans-serif" }}>
            Your finance team,<br/>
            <span className="sc-wordmark">in the shadows.</span>
          </h1>
          <p className="sc-rise-2" style={{ fontSize:16, lineHeight:1.65, color:"var(--sc-text-2)", margin:"0 0 40px", maxWidth:460 }}>
            Shadow is the AI controller that does the books, watches the numbers, and tells you what matters — before you have to ask.
          </p>
          <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
            {features.map(([t, d], i) => (
              <div key={t} className={`sc-rise-${i+2}`} style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                <div style={{ width:30, height:30, borderRadius:9, flexShrink:0, marginTop:2, background:"linear-gradient(135deg, rgba(139,123,255,.18), rgba(109,94,246,.08))", border:"1px solid var(--sc-border-2)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--sc-gold)", fontSize:13 }}>✦</div>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, marginBottom:3 }}>{t}</div>
                  <div style={{ fontSize:13, color:"var(--sc-text-2)", lineHeight:1.55, maxWidth:420 }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sc-fade" style={{ fontSize:12, color:"var(--sc-text-mut)", letterSpacing:0.3 }}>
          Tenant-isolated (RLS) · ASC 842 compliant · Full audit trail
        </div>
      </div>

      {/* ── Right: auth card ── */}
      <div style={{ flex:"1 1 380px", display:"flex", alignItems:"center", justifyContent:"center", padding:"48px 32px", background:"var(--sc-surface)", borderLeft:"1px solid var(--sc-border)", boxShadow:"-1px 0 0 var(--sc-border)" }}>
        <div className="sc-scale" style={{ width:"100%", maxWidth:380 }}>
          {invite && (
            inviteValid ? (
              <div style={{ background:"var(--sc-gold-soft)", border:"1px solid var(--sc-gold)", borderRadius:12, padding:"12px 14px", marginBottom:18, fontSize:13, color:"var(--sc-gold)", lineHeight:1.5 }}>
                ✦ You've been invited to join <strong>{invite.companyName || "a team"}</strong> as {invite.role === "admin" ? "an admin" : "a member"} — sign up or log in to accept.
              </div>
            ) : (
              <div style={{ background:"var(--sc-error-soft)", border:"1px solid var(--sc-error-soft)", borderRadius:12, padding:"12px 14px", marginBottom:18, fontSize:13, color:"var(--sc-error)", lineHeight:1.5 }}>
                This invite link is invalid or has expired. Ask whoever invited you to send a fresh one.
              </div>
            )
          )}
          <div style={{ marginBottom:28 }}>
            <h2 style={{ fontSize:24, fontWeight:700, margin:"0 0 6px", letterSpacing:-0.5, fontFamily:"'Space Grotesk','DM Sans',sans-serif" }}>
              {mode === "login" ? "Welcome back" : mode === "signup" ? "Get started" : "Reset your password"}
            </h2>
            <div style={{ fontSize:13, color:"var(--sc-text-2)" }}>
              {mode === "login" ? "Sign in to your Shadow workspace." : mode === "signup" ? "Create your workspace in seconds." : "Enter your email and we'll send you a secure reset link."}
            </div>
          </div>

          {error && <div style={{ background:"var(--sc-error-soft)", border:"1px solid var(--sc-error-soft)", borderRadius:10, padding:"10px 14px", fontSize:13, color:"var(--sc-error)", marginBottom:14 }}>{error}</div>}
          {message && <div style={{ background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", borderRadius:10, padding:"10px 14px", fontSize:13, color:"var(--sc-success)", marginBottom:14 }}>{message}</div>}

          {mode === "signup" && (
            <>
              <div style={label}>FULL NAME</div>
              <input style={input} value={name} onChange={e=>setName(e.target.value)} placeholder="Jane Smith"/>
            </>
          )}
          <div style={label}>EMAIL</div>
          <input style={input} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" onKeyDown={e=>e.key==="Enter"&&handle()}/>
          {mode !== "reset" && (
            <>
              <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between" }}>
                <div style={label}>PASSWORD</div>
                {mode === "login" && (
                  <span style={{ fontSize:12, color:"var(--sc-gold)", cursor:"pointer", fontWeight:500 }} onClick={()=>{ setMode("reset"); setError(null); setMessage(null); }}>Forgot password?</span>
                )}
              </div>
              <input style={input} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handle()}/>
            </>
          )}

          <button className="sc-cta" style={{ width:"100%", padding:"13px", borderRadius:11, fontSize:14, fontWeight:600, background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border:"none", color:"var(--sc-on-accent)", cursor:loading?"wait":"pointer", marginTop:10, letterSpacing:0.3, boxShadow:"0 8px 24px rgba(109,94,246,.32)" }} onClick={handle} disabled={loading}>
            {loading ? "One moment…" : mode === "login" ? "Sign in →" : mode === "signup" ? "Create account →" : "Send reset link →"}
          </button>

          <div style={{ textAlign:"center", marginTop:22, fontSize:13, color:"var(--sc-text-2)" }}>
            {mode === "login"
              ? <>New to Shadow? <span style={{ color:"var(--sc-gold)", cursor:"pointer", fontWeight:500 }} onClick={()=>{setMode("signup");setError(null);}}>Create an account</span></>
              : mode === "signup"
              ? <>Already have an account? <span style={{ color:"var(--sc-gold)", cursor:"pointer", fontWeight:500 }} onClick={()=>{setMode("login");setError(null);}}>Sign in</span></>
              : <span style={{ color:"var(--sc-gold)", cursor:"pointer", fontWeight:500 }} onClick={()=>{setMode("login");setError(null);setMessage(null);}}>← Back to sign in</span>}
          </div>

          {/* Legal footer (Item 18) */}
          <div style={{ textAlign:"center", marginTop:26, fontSize:12, color:"var(--sc-text-mut)" }}>
            <span style={{ cursor:"pointer" }} onClick={()=>setLegal("terms")}>Terms of Service</span>
            <span style={{ margin:"0 8px", color:"var(--sc-border-2)" }}>·</span>
            <span style={{ cursor:"pointer" }} onClick={()=>setLegal("privacy")}>Privacy Policy</span>
          </div>
        </div>
      </div>
    </div>
  );
}


// Shown when the user arrives via a password-reset email (PASSWORD_RECOVERY).
// They already hold a temporary recovery session, so we just collect a new password.
function UpdatePasswordScreen({ onDone }) {
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const label = { fontSize:11, color:"var(--sc-text-2)", marginBottom:6, letterSpacing:1, fontWeight:500 };
  const input = { width:"100%", boxSizing:"border-box", background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", borderRadius:11, padding:"12px 14px", color:"var(--sc-text)", fontSize:14, outline:"none", marginBottom:14, fontFamily:"'DM Sans', sans-serif" };

  const submit = async () => {
    setError(null);
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Those passwords don't match."); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      onDone();
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:"32px", background:"var(--sc-bg)", fontFamily:"'DM Sans', system-ui, sans-serif", color:"var(--sc-text)" }}>
      <div className="sc-scale" style={{ width:"100%", maxWidth:380, background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:16, padding:"32px 28px", boxShadow:"0 12px 40px rgba(16,24,40,0.08)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
          <EclipseMark size={36} />
          <div className="sc-wordmark" style={{ fontSize:16, fontWeight:700, letterSpacing:2, fontFamily:"'Space Grotesk','DM Sans',sans-serif" }}>SHADOW CFO</div>
        </div>
        <h2 style={{ fontSize:22, fontWeight:700, margin:"0 0 6px", letterSpacing:-0.5, fontFamily:"'Space Grotesk','DM Sans',sans-serif" }}>Set a new password</h2>
        <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:22 }}>Choose a new password for your account.</div>

        {error && <div style={{ background:"var(--sc-error-soft)", border:"1px solid var(--sc-error-soft)", borderRadius:10, padding:"10px 14px", fontSize:13, color:"var(--sc-error)", marginBottom:14 }}>{error}</div>}

        <div style={label}>NEW PASSWORD</div>
        <input style={input} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&submit()}/>
        <div style={label}>CONFIRM PASSWORD</div>
        <input style={input} type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&submit()}/>

        <button className="sc-cta" style={{ width:"100%", padding:"13px", borderRadius:11, fontSize:14, fontWeight:600, background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border:"none", color:"var(--sc-on-accent)", cursor:loading?"wait":"pointer", marginTop:8, letterSpacing:0.3, boxShadow:"0 8px 24px rgba(109,94,246,.32)" }} onClick={submit} disabled={loading}>
          {loading ? "Saving…" : "Update password →"}
        </button>
      </div>
    </div>
  );
}

export { UpdatePasswordScreen };
export default AuthScreen;
