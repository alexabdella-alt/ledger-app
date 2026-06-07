import React from "react";
import { useERP } from "../ERPContext";

export default function CoaView() {
  const {
    CHART_OF_ACCOUNTS, persistAccountEdit, deleteAccount, addCustomAccount,
    coaEditingCode, setCoaEditingCode, coaEditDraft, setCoaEditDraft,
    coaAddDraft, setCoaAddDraft, coaShowAdd, setCoaShowAdd, showNotification,
  } = useERP();

  const editingId = coaEditingCode; const setEditingId = setCoaEditingCode;
  const editDraft = coaEditDraft; const setEditDraft = setCoaEditDraft;
  const addDraft = coaAddDraft; const setAddDraft = setCoaAddDraft;
  const showAdd = coaShowAdd; const setShowAdd = setCoaShowAdd;
  const categories = ["Assets", "Liabilities", "Equity", "Revenue", "Expenses"];
  const grouped = categories.map(cat => ({ cat, accounts: (CHART_OF_ACCOUNTS || []).filter(a => a.category === cat) }));

  const startEdit = (acct) => { setEditingId(acct.db_id || acct.code); setEditDraft({ code: acct.code, name: acct.name, category: acct.category }); };
  const saveEdit = async (acct) => {
    const ok = await persistAccountEdit(acct, { code: editDraft.code, name: editDraft.name, category: editDraft.category });
    if (ok) setEditingId(null);
  };
  const addAccount = async () => {
    if (!addDraft.code || !addDraft.name) return;
    const ok = await addCustomAccount({ code: addDraft.code, name: addDraft.name, category: addDraft.category });
    if (ok) { setAddDraft({ code: "", name: "", category: "Expenses" }); setShowAdd(false); }
  };
  const toggleActive = (acct) => persistAccountEdit(acct, { active: acct.active === false ? true : false });
  const removeAccount = (acct) => deleteAccount(acct);

  const lockIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "#6B7280", marginBottom: 8 }}>CONFIGURATION</div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Chart of Accounts</h1>
          <div style={{ fontSize: 13, color: "#6B7280", marginTop: 6 }}>Rename or renumber any account freely — the app tracks accounts by role, so reports and automations keep working. System accounts can be renamed but not deleted.</div>
        </div>
        <button onClick={() => setShowAdd(v => !v)} style={{ padding: "9px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, background: "linear-gradient(135deg,#4F46E5,#4338CA)", border: "none", color: "#fff", cursor: "pointer" }}>+ Add Account</button>
      </div>

      {showAdd && (
        <div style={{ background: "#FFFFFF", border: "1px solid #4F46E533", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: "#4F46E5", fontWeight: 600, marginBottom: 14, letterSpacing: 0.5 }}>NEW ACCOUNT</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr auto", gap: 12, alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>CODE</div>
              <input value={addDraft.code} onChange={e => setAddDraft(d => ({ ...d, code: e.target.value }))} placeholder="e.g. 6550"
                style={{ width: "100%", boxSizing: "border-box", background: "#F3F4F6", border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 10px", color: "#111827", fontSize: 13, outline: "none", fontFamily: "'DM Mono',monospace" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>NAME</div>
              <input value={addDraft.name} onChange={e => setAddDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Research & Development"
                style={{ width: "100%", boxSizing: "border-box", background: "#F3F4F6", border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 10px", color: "#111827", fontSize: 13, outline: "none" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>CATEGORY</div>
              <select value={addDraft.category} onChange={e => setAddDraft(d => ({ ...d, category: e.target.value }))}
                style={{ width: "100%", background: "#F3F4F6", border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 10px", color: "#111827", fontSize: 13, outline: "none" }}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button onClick={addAccount} style={{ padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "linear-gradient(135deg,#4F46E5,#4338CA)", border: "none", color: "#fff", cursor: "pointer" }}>Add</button>
          </div>
        </div>
      )}

      {grouped.map(({ cat, accounts }) => (
        <div key={cat} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#6B7280", letterSpacing: 2, marginBottom: 10, paddingLeft: 4 }}>{cat.toUpperCase()} — {accounts.length} accounts</div>
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {accounts.map((acct, i) => {
                  const isEditing = editingId === (acct.db_id || acct.code);
                  const isInactive = acct.active === false;
                  const isSystem = !!acct.system_role;
                  return (
                    <tr key={acct.db_id || acct.code} style={{ borderTop: i > 0 ? "1px solid #E5E7EB" : "none", background: isInactive ? "#F8F9FB" : i % 2 === 0 ? "transparent" : "#F8F9FB", opacity: isInactive ? 0.5 : 1 }}>
                      <td style={{ padding: "11px 16px", width: 80 }}>
                        {isEditing
                          ? <input value={editDraft.code} onChange={e => setEditDraft(d => ({ ...d, code: e.target.value }))}
                              style={{ width: 64, background: "#F3F4F6", border: "1px solid #4F46E5", borderRadius: 6, padding: "4px 8px", color: "#111827", fontSize: 12, outline: "none", fontFamily: "'DM Mono',monospace" }} />
                          : <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#6B7280" }}>{acct.code}</span>}
                      </td>
                      <td style={{ padding: "11px 16px" }}>
                        {isEditing
                          ? <input value={editDraft.name} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                              style={{ width: "100%", background: "#F3F4F6", border: "1px solid #4F46E5", borderRadius: 6, padding: "4px 8px", color: "#111827", fontSize: 13, outline: "none" }} />
                          : <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, color: isInactive ? "#6B7280" : "#111827" }}>
                              {acct.name}
                              {isSystem && <span title="System account — rename freely but cannot be deleted" style={{ color: "#9CA3AF", display: "inline-flex" }}>{lockIcon}</span>}
                            </span>}
                      </td>
                      <td style={{ padding: "11px 16px", width: 130 }}>
                        {isEditing
                          ? <select value={editDraft.category} onChange={e => setEditDraft(d => ({ ...d, category: e.target.value }))}
                              style={{ background: "#F3F4F6", border: "1px solid #4F46E5", borderRadius: 6, padding: "4px 6px", color: "#111827", fontSize: 12, outline: "none" }}>
                              {categories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          : <span style={{ fontSize: 11, background: "#E5E7EB", color: "#6B7280", borderRadius: 20, padding: "2px 9px" }}>{acct.category}</span>}
                      </td>
                      <td style={{ padding: "11px 16px", width: 190 }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEdit(acct)} style={{ padding: "4px 12px", borderRadius: 7, fontSize: 11, fontWeight: 600, background: "linear-gradient(135deg,#D1FAE5,#059669)", border: "none", color: "#059669", cursor: "pointer" }}>Save</button>
                              <button onClick={() => setEditingId(null)} style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, background: "transparent", border: "1px solid #D1D5DB", color: "#6B7280", cursor: "pointer" }}>×</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(acct)} style={{ padding: "4px 12px", borderRadius: 7, fontSize: 11, background: "transparent", border: "1px solid #D1D5DB", color: "#6B7280", cursor: "pointer" }}>Edit</button>
                              <button onClick={() => toggleActive(acct)} style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, background: "transparent", border: "1px solid #D1D5DB", color: isInactive ? "#059669" : "#6B7280", cursor: "pointer" }}>{isInactive ? "Enable" : "Disable"}</button>
                              {isSystem
                                ? <span title="System account — cannot be deleted" style={{ padding: "4px 8px", color: "#D1D5DB", display: "inline-flex", alignItems: "center" }}>{lockIcon}</span>
                                : <button onClick={() => removeAccount(acct)} style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, background: "transparent", border: "1px solid #DC262633", color: "#DC2626", cursor: "pointer" }}>Delete</button>}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
