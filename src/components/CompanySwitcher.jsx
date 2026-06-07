import React from "react";

function CompanySwitcher({ companies, currentCompany, onSwitch, onNew, userName }) {
  const [open, setOpen] = React.useState(false);
  const s = {
    wrap: { position:"relative" },
    btn: { display:"flex", alignItems:"center", gap:8, padding:"6px 12px", borderRadius:10, background:"#E4E7EC", border:"1px solid #D0D5DD", cursor:"pointer", color:"#101828", fontSize:13, fontWeight:500 },
    dot: { width:8, height:8, borderRadius:"50%", background:"#039855", flexShrink:0 },
    dropdown: { position:"absolute", top:"calc(100% + 8px)", left:0, background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:12, minWidth:240, boxShadow:"0 16px 48px rgba(0,0,0,0.6)", zIndex:100, overflow:"hidden" },
    header: { padding:"12px 16px", borderBottom:"1px solid #E4E7EC", fontSize:11, color:"#475467", letterSpacing:1 },
    item: { padding:"11px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:10, fontSize:13 },
    check: { width:16, height:16, borderRadius:4, background:"#039855", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#fff", flexShrink:0 },
    empty: { width:16, height:16, borderRadius:4, border:"1px solid #D0D5DD", flexShrink:0 },
    addBtn: { padding:"11px 16px", cursor:"pointer", fontSize:13, color:"#4F46E5", borderTop:"1px solid #E4E7EC", display:"flex", alignItems:"center", gap:8 },
  };
  return (
    <div style={s.wrap}>
      <div style={s.btn} onClick={()=>setOpen(o=>!o)}>
        <div style={s.dot}/>
        <span>{currentCompany?.name || "Select company"}</span>
        <span style={{color:"#475467",fontSize:10}}>▾</span>
      </div>
      {open && (
        <div style={s.dropdown}>
          <div style={s.header}>YOUR COMPANIES</div>
          {companies.map(c=>(
            <div key={c.id} style={{...s.item, background:c.id===currentCompany?.id?"#F3F4F6":"transparent"}}
              onClick={()=>{onSwitch(c);setOpen(false);}}>
              {c.id===currentCompany?.id ? <div style={s.check}>✓</div> : <div style={s.empty}/>}
              <span style={{fontWeight:c.id===currentCompany?.id?600:400}}>{c.name}</span>
            </div>
          ))}
          <div style={s.addBtn} onClick={()=>{onNew();setOpen(false);}}>
            <span>+</span> Add new company
          </div>
        </div>
      )}
    </div>
  );
}


export default CompanySwitcher;
