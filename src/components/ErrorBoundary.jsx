import React from "react";

// Catches render/runtime errors anywhere in the tree so one bad component
// shows a recoverable message instead of blanking the whole page.
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[ErrorBoundary] caught:", error, info?.componentStack); }
  reset = () => this.setState({ error: null });
  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    return (
      <div style={{ minHeight:"100vh", background:"var(--sc-bg)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"'DM Sans', system-ui, sans-serif" }}>
        <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:16, boxShadow:"0 8px 28px rgba(17,24,39,0.10)", padding:32, maxWidth:560, width:"100%" }}>
          <div style={{ fontSize:34, marginBottom:10 }}>⚠️</div>
          <h1 style={{ fontSize:20, fontWeight:700, margin:"0 0 8px", color:"var(--sc-text)" }}>Something went wrong on this screen</h1>
          <p style={{ fontSize:14, color:"var(--sc-text-2)", lineHeight:1.6, margin:"0 0 16px" }}>
            The rest of the app is fine. Try reloading, or head back to your dashboard. If it keeps happening, send us the detail below.
          </p>
          <pre style={{ fontSize:12, color:"var(--sc-error)", background:"var(--sc-error-soft)", border:"1px solid var(--sc-error-soft)", borderRadius:10, padding:"12px 14px", whiteSpace:"pre-wrap", wordBreak:"break-word", margin:"0 0 18px", maxHeight:200, overflow:"auto" }}>{msg}</pre>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <button onClick={()=>{ try { localStorage.setItem("cfai_view","home"); } catch {} window.location.reload(); }}
              style={{ padding:"11px 18px", borderRadius:10, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", fontSize:14, fontWeight:600, cursor:"pointer" }}>Reload &amp; go Home</button>
            <button onClick={this.reset}
              style={{ padding:"11px 18px", borderRadius:10, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:14, cursor:"pointer" }}>Try again</button>
          </div>
        </div>
      </div>
    );
  }
}
