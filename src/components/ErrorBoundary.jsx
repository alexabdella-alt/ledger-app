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
      <div style={{ minHeight:"100vh", background:"#F7F8FA", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"'DM Sans', system-ui, sans-serif" }}>
        <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:16, boxShadow:"0 8px 28px rgba(17,24,39,0.10)", padding:32, maxWidth:560, width:"100%" }}>
          <div style={{ fontSize:34, marginBottom:10 }}>⚠️</div>
          <h1 style={{ fontSize:20, fontWeight:700, margin:"0 0 8px", color:"#101828" }}>Something went wrong on this screen</h1>
          <p style={{ fontSize:14, color:"#475467", lineHeight:1.6, margin:"0 0 16px" }}>
            The rest of the app is fine. Try reloading, or head back to your dashboard. If it keeps happening, send us the detail below.
          </p>
          <pre style={{ fontSize:12, color:"#D92D20", background:"#FEF2F2", border:"1px solid #D92D2033", borderRadius:10, padding:"12px 14px", whiteSpace:"pre-wrap", wordBreak:"break-word", margin:"0 0 18px", maxHeight:200, overflow:"auto" }}>{msg}</pre>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <button onClick={()=>{ try { localStorage.setItem("cfai_view","home"); } catch {} window.location.reload(); }}
              style={{ padding:"11px 18px", borderRadius:10, background:"#4F46E5", border:"none", color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>Reload &amp; go Home</button>
            <button onClick={this.reset}
              style={{ padding:"11px 18px", borderRadius:10, background:"#FFFFFF", border:"1px solid #D0D5DD", color:"#374151", fontSize:14, cursor:"pointer" }}>Try again</button>
          </div>
        </div>
      </div>
    );
  }
}
