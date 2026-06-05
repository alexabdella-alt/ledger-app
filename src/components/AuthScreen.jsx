import React from "react";
import { supabase } from "../lib/supabase";

// Shadow CFO eclipse mark — a luminous disc partly occluded by shadow.
function EclipseMark({ size = 40 }) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#A99CFF" />
          <stop offset="100%" stopColor="#6D5EF6" />
        </linearGradient>
        <radialGradient id={`r${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8B7BFF" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#8B7BFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill={`url(#r${id})`} />
      <circle cx="24" cy="24" r="13" fill={`url(#g${id})`} />
      <circle cx="30.5" cy="20.5" r="11" fill="#0C0C0E" />
    </svg>
  );
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = React.useState("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [message, setMessage] = React.useState(null);

  const handle = async () => {
    setLoading(true); setError(null); setMessage(null);
    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.session);
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

  const label = { fontSize:11, color:"#86868F", marginBottom:6, letterSpacing:1, fontWeight:500 };
  const input = { width:"100%", boxSizing:"border-box", background:"#0C0C0E", border:"1px solid #262629", borderRadius:11, padding:"12px 14px", color:"#F2F2F4", fontSize:14, outline:"none", marginBottom:14, transition:"border-color .2s, box-shadow .2s", fontFamily:"'DM Sans', sans-serif" };

  const features = [
    ["Autonomous bookkeeping", "Drop any document — invoices, contracts, statements. It codes the GL, books the entry, and explains why."],
    ["A CFO that never sleeps", "Ask for burn rate, runway, or a P&L in plain English and get an answer grounded in your real ledger."],
    ["Audit-ready by default", "ASC 842 leases, full journal trails, and a tamper-evident audit log baked in from day one."],
  ];

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexWrap:"wrap", fontFamily:"'DM Sans', system-ui, sans-serif", color:"#F2F2F4", position:"relative", overflow:"hidden" }}>
      {/* ── Left: brand hero ── */}
      <div style={{ flex:"1 1 460px", minWidth:0, padding:"clamp(40px, 6vw, 96px)", display:"flex", flexDirection:"column", justifyContent:"space-between", gap:48, position:"relative" }}>
        <div className="sc-rise" style={{ display:"flex", alignItems:"center", gap:14 }}>
          <span className="sc-float"><EclipseMark size={44} /></span>
          <div>
            <div className="sc-wordmark" style={{ fontSize:22, fontWeight:700, letterSpacing:3, fontFamily:"'Space Grotesk','DM Sans',sans-serif" }}>SHADOW CFO</div>
            <div style={{ fontSize:11, color:"#86868F", letterSpacing:2, marginTop:2 }}>AUTONOMOUS FINANCE</div>
          </div>
        </div>

        <div style={{ maxWidth:540 }}>
          <h1 className="sc-rise-1" style={{ fontSize:"clamp(34px, 4.4vw, 56px)", lineHeight:1.05, fontWeight:700, margin:"0 0 20px", letterSpacing:-1.5, fontFamily:"'Space Grotesk','DM Sans',sans-serif" }}>
            Your finance team,<br/>
            <span className="sc-wordmark">in the shadows.</span>
          </h1>
          <p className="sc-rise-2" style={{ fontSize:16, lineHeight:1.65, color:"#9A9AA2", margin:"0 0 40px", maxWidth:460 }}>
            Shadow CFO is the AI controller that does the books, watches the numbers, and tells you what matters — before you have to ask.
          </p>
          <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
            {features.map(([t, d], i) => (
              <div key={t} className={`sc-rise-${i+2}`} style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                <div style={{ width:30, height:30, borderRadius:9, flexShrink:0, marginTop:2, background:"linear-gradient(135deg, rgba(139,123,255,.18), rgba(109,94,246,.08))", border:"1px solid #2E2E36", display:"flex", alignItems:"center", justifyContent:"center", color:"#A99CFF", fontSize:13 }}>✦</div>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, marginBottom:3 }}>{t}</div>
                  <div style={{ fontSize:13, color:"#86868F", lineHeight:1.55, maxWidth:420 }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sc-fade" style={{ fontSize:12, color:"#55555C", letterSpacing:0.3 }}>
          Tenant-isolated (RLS) · ASC 842 compliant · Full audit trail
        </div>
      </div>

      {/* ── Right: auth card ── */}
      <div style={{ flex:"1 1 380px", display:"flex", alignItems:"center", justifyContent:"center", padding:"48px 32px", background:"linear-gradient(180deg, rgba(20,20,22,.45), rgba(12,12,14,.7))", borderLeft:"1px solid #1C1C20", backdropFilter:"blur(6px)" }}>
        <div className="sc-scale" style={{ width:"100%", maxWidth:380 }}>
          <div style={{ marginBottom:28 }}>
            <h2 style={{ fontSize:24, fontWeight:700, margin:"0 0 6px", letterSpacing:-0.5, fontFamily:"'Space Grotesk','DM Sans',sans-serif" }}>
              {mode === "login" ? "Welcome back" : "Get started"}
            </h2>
            <div style={{ fontSize:13, color:"#86868F" }}>
              {mode === "login" ? "Sign in to your Shadow CFO workspace." : "Create your workspace in seconds."}
            </div>
          </div>

          {error && <div style={{ background:"#2A0A0A", border:"1px solid #EF444433", borderRadius:10, padding:"10px 14px", fontSize:13, color:"#FCA5A5", marginBottom:14 }}>{error}</div>}
          {message && <div style={{ background:"#0A2A1A", border:"1px solid #10B98133", borderRadius:10, padding:"10px 14px", fontSize:13, color:"#6EE7B7", marginBottom:14 }}>{message}</div>}

          {mode === "signup" && (
            <>
              <div style={label}>FULL NAME</div>
              <input style={input} value={name} onChange={e=>setName(e.target.value)} placeholder="Jane Smith"/>
            </>
          )}
          <div style={label}>EMAIL</div>
          <input style={input} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" onKeyDown={e=>e.key==="Enter"&&handle()}/>
          <div style={label}>PASSWORD</div>
          <input style={input} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handle()}/>

          <button className="sc-cta" style={{ width:"100%", padding:"13px", borderRadius:11, fontSize:14, fontWeight:600, background:"linear-gradient(135deg,#6D5EF6,#4A3DB8)", border:"none", color:"#fff", cursor:loading?"wait":"pointer", marginTop:10, letterSpacing:0.3, boxShadow:"0 8px 24px rgba(109,94,246,.32)" }} onClick={handle} disabled={loading}>
            {loading ? "One moment…" : mode === "login" ? "Sign in →" : "Create account →"}
          </button>

          <div style={{ textAlign:"center", marginTop:22, fontSize:13, color:"#86868F" }}>
            {mode === "login"
              ? <>New to Shadow CFO? <span style={{ color:"#C7BFFF", cursor:"pointer", fontWeight:500 }} onClick={()=>{setMode("signup");setError(null);}}>Create an account</span></>
              : <>Already have an account? <span style={{ color:"#C7BFFF", cursor:"pointer", fontWeight:500 }} onClick={()=>{setMode("login");setError(null);}}>Sign in</span></>}
          </div>
        </div>
      </div>
    </div>
  );
}


export default AuthScreen;
