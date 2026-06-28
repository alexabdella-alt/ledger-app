import React from "react";
import { useERP } from "../ERPContext";

export default function CoaView() {
  const {
    CHART_OF_ACCOUNTS, persistAccountEdit, deleteAccount, addCustomAccount,
    coaEditingCode, setCoaEditingCode, coaEditDraft, setCoaEditDraft,
    coaAddDraft, setCoaAddDraft, coaShowAdd, setCoaShowAdd, showNotification, setDeleteConfirm,
  } = useERP();

  const editingId = coaEditingCode; const setEditingId = setCoaEditingCode;
  const editDraft = coaEditDraft; const setEditDraft = setCoaEditDraft;
  const addDraft = coaAddDraft; const setAddDraft = setCoaAddDraft;
  const showAdd = coaShowAdd; const setShowAdd = setCoaShowAdd;
  const categories = ["Assets", "Liabilities", "Equity", "Revenue", "Expenses"];
  const grouped = categories.map(cat => ({ cat, accounts: (CHART_OF_ACCOUNTS || []).filter(a => a.category === cat) }));

  const [busy, setBusy] = React.useState(null); // id/code currently being mutated (disables its buttons)
  const codeError = (code, selfCode) => {
    if (!/^\d{4}$/.test(String(code || "").trim())) return "Account code must be exactly 4 digits.";
    if (code !== selfCode && (CHART_OF_ACCOUNTS || []).some(a => a.code === code)) return "That account code is already in use.";
    return null;
  };

  const startEdit = (acct) => { setEditingId(acct.db_id || acct.code); setEditDraft({ code: acct.code, name: acct.name, category: acct.category }); };
  const saveEdit = async (acct) => {
    const err = codeError(editDraft.code, acct.code);
    if (err) { showNotification(err, "error"); return; }
    if (!String(editDraft.name || "").trim()) { showNotification("Account name can't be empty.", "error"); return; }
    setBusy(acct.db_id || acct.code);
    const ok = await persistAccountEdit(acct, { code: editDraft.code.trim(), name: editDraft.name.trim(), category: editDraft.category });
    setBusy(null);
    if (ok) setEditingId(null);
  };
  const addAccount = async () => {
    const err = codeError(addDraft.code, null);
    if (err) { showNotification(err, "error"); return; }
    if (!String(addDraft.name || "").trim()) { showNotification("Please enter an account name.", "error"); return; }
    setBusy("add");
    const ok = await addCustomAccount({ code: addDraft.code.trim(), name: addDraft.name.trim(), category: addDraft.category });
    setBusy(null);
    if (ok) { setAddDraft({ code: "", name: "", category: "Expenses" }); setShowAdd(false); }
  };
  const toggleActive = async (acct) => { setBusy(acct.db_id || acct.code); await persistAccountEdit(acct, { active: acct.active === false ? true : false }); setBusy(null); };
  const removeAccount = (acct) => {
    // Confirm before deleting a chart-of-accounts account (deleteAccount already blocks
    // system accounts + accounts with transactions, but deletion still warrants a confirm).
    setDeleteConfirm({
      label: `Delete account ${acct.code} · ${acct.name}? This can't be undone. (System accounts and accounts with transactions are protected.)`,
      onConfirm: async () => { setBusy(acct.db_id || acct.code); await deleteAccount(acct); setBusy(null); },
    });
  };

  const lockIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "var(--sc-text-2)", marginBottom: 8 }}>CONFIGURATION</div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Chart of Accounts</h1>
          <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6 }}>Rename or renumber any account freely — the app tracks accounts by role, so reports and automations keep working. System accounts can be renamed but not deleted.</div>
        </div>
        <button onClick={() => setShowAdd(v => !v)} style={{ padding: "9px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, background: "linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>+ Add Account</button>
      </div>

      {showAdd && (
        <div style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-gold-soft)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: "var(--sc-gold)", fontWeight: 600, marginBottom: 14, letterSpacing: 0.5 }}>NEW ACCOUNT</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr auto", gap: 12, alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--sc-text-2)", marginBottom: 4 }}>CODE</div>
              <input value={addDraft.code} onChange={e => setAddDraft(d => ({ ...d, code: e.target.value }))} placeholder="e.g. 6550"
                style={{ width: "100%", boxSizing: "border-box", background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "8px 10px", color: "var(--sc-text)", fontSize: 13, outline: "none", fontFamily: "'DM Mono',monospace" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--sc-text-2)", marginBottom: 4 }}>NAME</div>
              <input value={addDraft.name} onChange={e => setAddDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Research & Development"
                style={{ width: "100%", boxSizing: "border-box", background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "8px 10px", color: "var(--sc-text)", fontSize: 13, outline: "none" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--sc-text-2)", marginBottom: 4 }}>CATEGORY</div>
              <select value={addDraft.category} onChange={e => setAddDraft(d => ({ ...d, category: e.target.value }))}
                style={{ width: "100%", background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "8px 10px", color: "var(--sc-text)", fontSize: 13, outline: "none" }}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button onClick={addAccount} disabled={busy === "add"} style={{ padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: busy === "add" ? "var(--sc-gold)" : "linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border: "none", color: "var(--sc-on-accent)", cursor: busy === "add" ? "default" : "pointer" }}>{busy === "add" ? "Adding…" : "Add"}</button>
          </div>
        </div>
      )}

      {grouped.map(({ cat, accounts }) => (
        <div key={cat} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "var(--sc-text-2)", letterSpacing: 2, marginBottom: 10, paddingLeft: 4 }}>{cat.toUpperCase()} — {accounts.length} accounts</div>
          <div style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {accounts.map((acct, i) => {
                  const isEditing = editingId === (acct.db_id || acct.code);
                  const isInactive = acct.active === false;
                  const isSystem = !!acct.system_role;
                  const rowBusy = busy === (acct.db_id || acct.code);
                  return (
                    <tr key={acct.db_id || acct.code} style={{ borderTop: i > 0 ? "1px solid var(--sc-border)" : "none", background: isInactive ? "var(--sc-bg)" : i % 2 === 0 ? "transparent" : "var(--sc-bg)", opacity: isInactive ? 0.5 : 1 }}>
                      <td style={{ padding: "11px 16px", width: 80 }}>
                        {isEditing
                          ? <input value={editDraft.code} onChange={e => setEditDraft(d => ({ ...d, code: e.target.value }))}
                              style={{ width: 64, background: "var(--sc-surface-2)", border: "1px solid var(--sc-gold)", borderRadius: 6, padding: "4px 8px", color: "var(--sc-text)", fontSize: 12, outline: "none", fontFamily: "'DM Mono',monospace" }} />
                          : <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "var(--sc-text-2)" }}>{acct.code}</span>}
                      </td>
                      <td style={{ padding: "11px 16px" }}>
                        {isEditing
                          ? <input value={editDraft.name} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                              style={{ width: "100%", background: "var(--sc-surface-2)", border: "1px solid var(--sc-gold)", borderRadius: 6, padding: "4px 8px", color: "var(--sc-text)", fontSize: 13, outline: "none" }} />
                          : <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, color: isInactive ? "var(--sc-text-2)" : "var(--sc-text)" }}>
                              {acct.name}
                              {isSystem && <span title="System account — rename freely but cannot be deleted" style={{ color: "var(--sc-text-mut)", display: "inline-flex" }}>{lockIcon}</span>}
                            </span>}
                      </td>
                      <td style={{ padding: "11px 16px", width: 130 }}>
                        {isEditing
                          ? <select value={editDraft.category} onChange={e => setEditDraft(d => ({ ...d, category: e.target.value }))}
                              style={{ background: "var(--sc-surface-2)", border: "1px solid var(--sc-gold)", borderRadius: 6, padding: "4px 6px", color: "var(--sc-text)", fontSize: 12, outline: "none" }}>
                              {categories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          : <span style={{ fontSize: 11, background: "var(--sc-border)", color: "var(--sc-text-2)", borderRadius: 20, padding: "2px 9px" }}>{acct.category}</span>}
                      </td>
                      <td style={{ padding: "11px 16px", width: 190 }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEdit(acct)} disabled={rowBusy} style={{ padding: "4px 12px", borderRadius: 7, fontSize: 11, fontWeight: 600, background: "linear-gradient(135deg,var(--sc-success-soft),var(--sc-success))", border: "none", color: "var(--sc-success)", cursor: rowBusy ? "default" : "pointer", opacity: rowBusy ? 0.6 : 1 }}>{rowBusy ? "Saving…" : "Save"}</button>
                              <button onClick={() => setEditingId(null)} disabled={rowBusy} style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>×</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(acct)} disabled={rowBusy} style={{ padding: "4px 12px", borderRadius: 7, fontSize: 11, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer", opacity: rowBusy ? 0.6 : 1 }}>Edit</button>
                              <button onClick={() => toggleActive(acct)} disabled={rowBusy} style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, background: "transparent", border: "1px solid var(--sc-border-2)", color: isInactive ? "var(--sc-success)" : "var(--sc-text-2)", cursor: "pointer", opacity: rowBusy ? 0.6 : 1 }}>{isInactive ? "Enable" : "Disable"}</button>
                              {isSystem
                                ? <span title="System account — cannot be deleted" style={{ padding: "4px 8px", color: "var(--sc-border-2)", display: "inline-flex", alignItems: "center" }}>{lockIcon}</span>
                                : <button onClick={() => removeAccount(acct)} disabled={rowBusy} style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, background: "transparent", border: "1px solid var(--sc-error-soft)", color: "var(--sc-error)", cursor: rowBusy ? "default" : "pointer", opacity: rowBusy ? 0.6 : 1 }}>{rowBusy ? "…" : "Delete"}</button>}
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
