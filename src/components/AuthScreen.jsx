import React from "react";
import { supabase } from "../lib/supabase";

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

  const s = {
    wrap: { minHeight:"100vh", background:"#0A0A0F", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif" },
    card: { background:"#14141A", border:"1px solid #2A2A3E", borderRadius:20, padding:40, width:400, boxShadow:"0 24px 80px rgba(0,0,0,0.7)" },
    logo: { display:"flex", alignItems:"center", gap:12, marginBottom:32 },
    logoIcon: { width:44, height:44, borderRadius:12, background:"linear-gradient(135deg,#6D28D9,#9333EA)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 },
    h1: { fontSize:24, fontWeight:700, color:"#E8E8F0", margin:0, letterSpacing:-0.5 },
    sub: { fontSize:13, color:"#6B6B8A", marginTop:4 },
    label: { fontSize:11, color:"#6B6B8A", marginBottom:4, letterSpacing:0.5 },
    input: { width:"100%", boxSizing:"border-box", background:"#0F0F13", border:"1px solid #2A2A3E", borderRadius:10, padding:"11px 14px", color:"#E8E8F0", fontSize:14, outline:"none", marginBottom:12 },
    btn: { width:"100%", padding:"12px", borderRadius:10, fontSize:14, fontWeight:600, background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", cursor:"pointer", marginTop:8 },
    toggle: { textAlign:"center", marginTop:20, fontSize:13, color:"#6B6B8A" },
    toggleLink: { color:"#C8B8FF", cursor:"pointer", fontWeight:500 },
    error: { background:"#2A0A0A", border:"1px solid #EF444433", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#EF4444", marginBottom:12 },
    success: { background:"#0A2A1A", border:"1px solid #10B98133", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#10B981", marginBottom:12 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.logo}>
          <div style={s.logoIcon}>✦</div>
          <div>
            <div style={s.h1}>Ledger</div>
            <div style={s.sub}>AI-powered accounting</div>
          </div>
        </div>
        {error && <div style={s.error}>{error}</div>}
        {message && <div style={s.success}>{message}</div>}
        {mode === "signup" && (
          <div>
            <div style={s.label}>FULL NAME</div>
            <input style={s.input} value={name} onChange={e=>setName(e.target.value)} placeholder="Jane Smith"/>
          </div>
        )}
        <div style={s.label}>EMAIL</div>
        <input style={s.input} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" onKeyDown={e=>e.key==="Enter"&&handle()}/>
        <div style={s.label}>PASSWORD</div>
        <input style={s.input} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handle()}/>
        <button style={s.btn} onClick={handle} disabled={loading}>
          {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
        </button>
        <div style={s.toggle}>
          {mode === "login" ? <>No account? <span style={s.toggleLink} onClick={()=>{setMode("signup");setError(null);}}>Sign up free</span></> : <>Have an account? <span style={s.toggleLink} onClick={()=>{setMode("login");setError(null);}}>Sign in</span></>}
        </div>
      </div>
    </div>
  );
}


export default AuthScreen;
