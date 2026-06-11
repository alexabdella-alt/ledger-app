import React from "react";
import { useERP } from "../ERPContext";
import { parseQbo, normalizeQbo, matchAccount, isQboBankFile } from "../../lib/qboParser";
import { findDuplicate, downloadCSV } from "../../lib/insights";

const ROW_CAP = 10000;
const FIELDS = [["date", "Date"], ["type", "Type"], ["num", "Num"], ["name", "Vendor / Name"], ["account", "Account"], ["split", "Split"], ["amount", "Amount"], ["debit", "Debit"], ["credit", "Credit"], ["memo", "Memo / Description"]];
const money = n => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });

export default function QBOImportView() {
  const {
    currentCompany, session, supabase, CHART_OF_ACCOUNTS, getAccountByRole, getAccountByCode,
    invoices, isAdmin, logAudit, showNotification, setView, loadAllData, flagBookingVisibilityFailure,
  } = useERP();

  const [step, setStep] = React.useState("instructions"); // instructions|upload|columns|accounts|importing|summary
  const [fileName, setFileName] = React.useState("");
  const [grid, setGrid] = React.useState(null);           // raw 2D array
  const [headerIndex, setHeaderIndex] = React.useState(-1);
  const [columns, setColumns] = React.useState([]);
  const [colMap, setColMap] = React.useState({});
  const [parsed, setParsed] = React.useState({ rows: [], failed: [] });
  const [acctMap, setAcctMap] = React.useState({});       // qbAccountName -> our gl_code
  const [dragOver, setDragOver] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [result, setResult] = React.useState(null);
  const [recent, setRecent] = React.useState([]);
  const [undoing, setUndoing] = React.useState(null);
  const fileRef = React.useRef(null);

  const miscCode = getAccountByRole("miscellaneous_expense")?.code || "7100";
  const cashCode = getAccountByRole("cash")?.code || "1000";

  const loadRecent = React.useCallback(async () => {
    if (!currentCompany?.id) return;
    try {
      const { data } = await supabase.from("qbo_imports").select("*").eq("company_id", currentCompany.id).order("created_at", { ascending: false }).limit(10);
      setRecent(Array.isArray(data) ? data : []);
    } catch {}
  }, [currentCompany?.id, supabase]);
  React.useEffect(() => { loadRecent(); }, [loadRecent]);

  if (!isAdmin) return <div style={{ maxWidth: 720, color: "#475467", fontSize: 14 }}>Only an owner or admin can import data from QuickBooks.</div>;

  // ── File → 2D grid → parse ──
  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    if (isQboBankFile(file.name)) {
      showNotification("That's a .qbo bank statement, not QuickBooks company data — opening the bank import instead.", "info");
      setView("bank");
      return;
    }
    try {
      const XLSX = await import("xlsx"); // lazy — keeps xlsx out of the main bundle
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const g = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      if (g.length > ROW_CAP + 50) { showNotification(`That file has ~${g.length.toLocaleString()} rows. The limit is ${ROW_CAP.toLocaleString()} per file — split it into smaller exports (e.g. by quarter).`, "error"); return; }
      const res = parseQbo(g);
      if (res.headerIndex < 0) { showNotification(res.error || "Couldn't read that export — make sure it's a QuickBooks report exported as CSV or Excel.", "error"); return; }
      if (res.rows.length > ROW_CAP) { showNotification(`That export has ${res.rows.length.toLocaleString()} transactions — over the ${ROW_CAP.toLocaleString()} cap. Split it into smaller date ranges.`, "error"); return; }
      setGrid(g); setHeaderIndex(res.headerIndex); setColumns(res.columns); setColMap(res.colMap); setParsed({ rows: res.rows, failed: res.failed });
      // Pre-match accounts.
      const map = {};
      [...new Set(res.rows.map(r => r.account).filter(Boolean))].forEach(name => { map[name] = matchAccount(name, CHART_OF_ACCOUNTS, getAccountByRole) || miscCode; });
      setAcctMap(map);
      setStep("columns");
    } catch (e) { showNotification("Couldn't parse that file: " + (e?.message || e) + ". Try exporting as CSV.", "error"); }
  };

  // Recompute rows when the user corrects a column mapping.
  const remap = (field, idx) => {
    const cm = { ...colMap }; if (idx === "") delete cm[field]; else cm[field] = Number(idx);
    setColMap(cm);
    const { rows, failed } = normalizeQbo(grid, headerIndex, cm, columns);
    setParsed({ rows, failed });
    const map = { ...acctMap };
    [...new Set(rows.map(r => r.account).filter(Boolean))].forEach(name => { if (!(name in map)) map[name] = matchAccount(name, CHART_OF_ACCOUNTS, getAccountByRole) || miscCode; });
    setAcctMap(map);
  };

  // Distinct accounts with counts + totals (for the account-mapping step).
  const acctStats = React.useMemo(() => {
    const m = {};
    parsed.rows.forEach(r => { const k = r.account || "(blank)"; (m[k] = m[k] || { name: k, count: 0, total: 0 }); m[k].count++; m[k].total += Math.abs(Number(r.amount) || 0); });
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [parsed.rows]);

  const expenseAccts = (CHART_OF_ACCOUNTS || []).filter(a => a.category === "Expenses");
  const allAccts = (CHART_OF_ACCOUNTS || []);

  // ── The import ──
  const runImport = async () => {
    setStep("importing"); setProgress(0);
    const cid = currentCompany.id;
    const rows = parsed.rows;

    // Resolve account ids (create any missing).
    const neededCodes = new Set([cashCode]);
    rows.forEach(r => { neededCodes.add(acctMap[r.account] || miscCode); if (r.split) { const c = matchAccount(r.split, CHART_OF_ACCOUNTS, getAccountByRole); if (c) neededCodes.add(c); } });
    const acctId = {};
    try {
      const { data: accts } = await supabase.from("accounts").select("id, code").eq("company_id", cid);
      (accts || []).forEach(a => { acctId[a.code] = a.id; });
    } catch {}
    for (const code of neededCodes) {
      if (!acctId[code]) {
        const def = (CHART_OF_ACCOUNTS || []).find(a => a.code === code);
        try { const { data } = await supabase.from("accounts").insert({ company_id: cid, code, name: def?.name || code, account_type: (def?.category || "expense").toLowerCase() }).select("id").single(); if (data) acctId[code] = data.id; } catch {}
      }
    }

    // Create the batch record first → its id is the import_batch_id.
    let batchId = null;
    try {
      const { data } = await supabase.from("qbo_imports").insert({ company_id: cid, filename: fileName, row_count: rows.length, created_by: session?.user?.id || null }).select("id").single();
      batchId = data?.id || null;
    } catch {}

    let imported = 0, skipped = 0, failedN = parsed.failed.length, total = 0;
    const toBook = [];
    for (const r of rows) {
      const a = Number(r.amount) || 0;
      // Duplicate against already-booked entries.
      const dup = findDuplicate({ vendor: r.name || r.account, amount: Math.abs(a), date: r.date }, invoices);
      if (dup) { skipped++; continue; }
      const primaryCode = acctMap[r.account] || miscCode;
      const offsetCode = (r.split && matchAccount(r.split, CHART_OF_ACCOUNTS, getAccountByRole)) || cashCode;
      const pId = acctId[primaryCode], oId = acctId[offsetCode];
      if (!pId || !oId) { failedN++; continue; }
      toBook.push({ r, a, pId, oId });
      total += Math.abs(a);
    }

    // Batch insert in chunks of 50: entries first (get ids), then their lines.
    const CHUNK = 50;
    for (let i = 0; i < toBook.length; i += CHUNK) {
      const chunk = toBook.slice(i, i + CHUNK);
      const jeRows = chunk.map(({ r, a }) => ({
        company_id: cid, entry_date: r.date,
        description: `${r.name || r.account || "QuickBooks"} – ${r.memo || r.type || "Imported from QuickBooks"}`,
        source: "qbo_import", status: "posted", posted_at: new Date().toISOString(), created_by: session?.user?.id || null,
        import_batch_id: batchId, import_metadata: r._raw,
      }));
      try {
        const { data: created, error } = await supabase.from("journal_entries").insert(jeRows).select("id");
        if (error) throw error;
        const lines = [];
        (created || []).forEach((je, idx) => {
          const { a, pId, oId } = chunk[idx];
          const amt = Math.abs(a);
          if (a >= 0) { lines.push({ journal_entry_id: je.id, company_id: cid, account_id: pId, debit: amt, credit: 0 }, { journal_entry_id: je.id, company_id: cid, account_id: oId, debit: 0, credit: amt }); }
          else { lines.push({ journal_entry_id: je.id, company_id: cid, account_id: pId, debit: 0, credit: amt }, { journal_entry_id: je.id, company_id: cid, account_id: oId, debit: amt, credit: 0 }); }
        });
        await supabase.from("journal_entry_lines").insert(lines);
        imported += (created || []).length;
      } catch (e) { console.warn("[qbo] chunk insert failed:", e?.message || e); failedN += chunk.length; }
      setProgress(Math.round(((i + chunk.length) / Math.max(1, toBook.length)) * 100));
    }

    // Finalize the batch record + audit.
    try { if (batchId) await supabase.from("qbo_imports").update({ imported_count: imported, skipped_count: skipped, failed_count: failedN, total_amount: Math.round(total * 100) / 100 }).eq("id", batchId).eq("company_id", cid); } catch {}
    logAudit && logAudit("qbo_import", `QuickBooks import: ${imported} entries booked, ${skipped} duplicates skipped, ${money(total)} total (batch ${batchId})`, null, { batch_id: batchId, imported, skipped, failed: failedN, total });

    // Post-booking visibility invariant (count level): entries inserted must equal
    // entries visible from this batch under the same filters loadAllData uses.
    if (batchId && imported > 0) {
      try {
        const { count } = await supabase.from("journal_entries")
          .select("id", { count: "exact", head: true })
          .eq("company_id", cid).eq("import_batch_id", batchId)
          .eq("status", "posted").is("deleted_at", null);
        if (count != null && count !== imported) {
          flagBookingVisibilityFailure({ batch_id: batchId, expected: imported, actual: count, source: "qbo_import" });
        }
      } catch (e) { console.warn("[qbo] visibility verify failed — not alarming:", e?.message || e); }
    }

    setResult({ imported, skipped, failed: failedN, total, accounts: Object.keys(acctMap).length, batchId });
    setStep("summary");
    loadRecent();
    loadAllData && loadAllData();
  };

  const undoImport = async (batch) => {
    setUndoing(batch.id);
    try {
      await supabase.from("journal_entries").update({ deleted_at: new Date().toISOString(), deleted_by: session?.user?.id || null }).eq("company_id", currentCompany.id).eq("import_batch_id", batch.id).is("deleted_at", null);
      await supabase.from("qbo_imports").update({ status: "undone", undone_at: new Date().toISOString() }).eq("id", batch.id).eq("company_id", currentCompany.id);
      logAudit && logAudit("qbo_import_undone", `Undid QuickBooks import ${batch.filename || ""} — removed ${batch.imported_count} entries (batch ${batch.id})`, batch, null);
      showNotification(`Import undone — ${batch.imported_count} entries removed. ✓`);
      loadRecent(); loadAllData && loadAllData();
    } catch (e) { showNotification("Couldn't undo: " + (e?.message || e), "error"); }
    setUndoing(null);
  };

  const downloadSkipped = () => {
    if (!parsed.failed.length) return;
    const cols = columns.length ? columns : Object.keys(parsed.failed[0].values || {});
    downloadCSV(`quickbooks-skipped-rows.csv`, ["Row #", "Reason", ...cols], parsed.failed.map(f => [f.row, f.reason, ...cols.map(c => f.values?.[c] ?? "")]));
  };

  // ── styles ──
  const card = { background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 14, padding: 24, marginBottom: 16 };
  const btn = (primary) => ({ height: 42, padding: "0 22px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", border: primary ? "none" : "1px solid #D0D5DD", background: primary ? "#4F46E5" : "#FFFFFF", color: primary ? "#fff" : "#374151" });
  const sel = { background: "#F3F4F6", border: "1px solid #D0D5DD", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "#101828", outline: "none" };
  const stepLabel = ["instructions", "upload", "columns", "accounts", "importing", "summary"];
  const stepNum = stepLabel.indexOf(step) + 1;

  return (
    <div style={{ maxWidth: 880 }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#475467", marginBottom: 8 }}>MIGRATION</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Import from QuickBooks</h1>
        <div style={{ fontSize: 13, color: "#475467", marginTop: 6 }}>Bring your transactions over from QuickBooks Online. {step !== "instructions" && step !== "summary" && `Step ${stepNum} of 5.`}</div>
      </div>

      {/* STEP 1 — Instructions */}
      {step === "instructions" && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>What to export from QuickBooks Online</div>
          {[
            ["Chart of Accounts", "Settings gear → Chart of accounts → Run report → Export to Excel"],
            ["Transactions", 'Reports → Transaction List by Date → set the date range to "All Dates" → Export to Excel or CSV'],
            ["Customers & Vendors (optional)", "Sales → Customers → Export; Expenses → Vendors → Export"],
          ].map(([t, d], i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "12px 0", borderTop: i ? "1px solid #F3F4F6" : "none" }}>
              <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#EEF2FF", color: "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
              <div><div style={{ fontSize: 13.5, fontWeight: 600, color: "#101828" }}>{t}</div><div style={{ fontSize: 12.5, color: "#475467", marginTop: 2, lineHeight: 1.5 }}>{d}</div></div>
            </div>
          ))}
          <div style={{ fontSize: 12.5, color: "#475467", background: "#F9FAFB", border: "1px solid #EEF0F4", borderRadius: 10, padding: "12px 14px", margin: "14px 0", lineHeight: 1.5 }}>Export as CSV or Excel — we handle both. The Transaction List is the important one; we'll auto-match your QuickBooks accounts to ours and let you fix anything before importing.</div>
          <button style={btn(true)} onClick={() => setStep("upload")}>I've got my export →</button>
        </div>
      )}

      {/* STEP 2 — Upload */}
      {step === "upload" && (
        <div style={card}>
          <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
            onClick={() => fileRef.current?.click()}
            style={{ border: `2px dashed ${dragOver ? "#4F46E5" : "#D0D5DD"}`, borderRadius: 14, padding: "48px 24px", textAlign: "center", cursor: "pointer", background: dragOver ? "#FAFAFF" : "#FFFFFF" }}>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; handleFile(f); }} />
            <div style={{ fontSize: 30, marginBottom: 10 }}>📑</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{dragOver ? "Release to upload" : "Drop your QuickBooks export here"}</div>
            <div style={{ fontSize: 13, color: "#667085" }}>CSV or Excel · up to {ROW_CAP.toLocaleString()} transactions</div>
          </div>
          <button style={{ ...btn(false), marginTop: 14 }} onClick={() => setStep("instructions")}>← Back to instructions</button>
        </div>
      )}

      {/* STEP 3 — Column mapping + preview */}
      {step === "columns" && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Confirm the columns</div>
          <div style={{ fontSize: 12.5, color: "#475467", marginBottom: 14 }}>We detected these from <strong>{fileName}</strong>. Fix any mapping if it looks off, then check the preview below.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginBottom: 18 }}>
            {FIELDS.map(([f, lbl]) => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#475467", width: 110, flexShrink: 0 }}>{lbl}</span>
                <select value={colMap[f] ?? ""} onChange={e => remap(f, e.target.value)} style={{ ...sel, flex: 1 }}>
                  <option value="">— none —</option>
                  {columns.map((c, i) => <option key={i} value={i}>{c || `Column ${i + 1}`}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#475467", marginBottom: 6 }}>PREVIEW — first 10 of {parsed.rows.length.toLocaleString()} transactions{parsed.failed.length ? ` · ${parsed.failed.length} rows couldn't be read` : ""}</div>
          <div style={{ overflowX: "auto", border: "1px solid #E4E7EC", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr style={{ background: "#F9FAFB" }}>{["Date", "Name", "Account", "Memo", "Amount"].map(h => <th key={h} style={{ padding: "8px 12px", textAlign: h === "Amount" ? "right" : "left", color: "#98A2B3", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>{parsed.rows.slice(0, 10).map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                  <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.date}</td>
                  <td style={{ padding: "8px 12px" }}>{r.name || "—"}</td>
                  <td style={{ padding: "8px 12px" }}>{r.account}</td>
                  <td style={{ padding: "8px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.memo || "—"}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "'DM Mono',monospace", color: r.amount < 0 ? "#039855" : "#101828" }}>{money(r.amount)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
            <button style={btn(true)} disabled={!parsed.rows.length} onClick={() => setStep("accounts")}>Looks right — map accounts →</button>
            <button style={btn(false)} onClick={() => setStep("upload")}>← Choose a different file</button>
            {parsed.failed.length > 0 && <button style={{ ...btn(false), marginLeft: "auto" }} onClick={downloadSkipped}>↓ Download {parsed.failed.length} skipped row{parsed.failed.length !== 1 ? "s" : ""}</button>}
          </div>
        </div>
      )}

      {/* STEP 4 — Account mapping */}
      {step === "accounts" && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Map your QuickBooks accounts</div>
          <div style={{ fontSize: 12.5, color: "#475467", marginBottom: 14 }}>We pre-matched each account. Amber rows defaulted to Miscellaneous — please review those.</div>
          <div style={{ border: "1px solid #E4E7EC", borderRadius: 10, overflow: "clip" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#F9FAFB" }}>{["QuickBooks account", "Txns", "Total", "Maps to"].map((h, i) => <th key={h} style={{ padding: "9px 14px", textAlign: i === 1 || i === 2 ? "right" : "left", color: "#98A2B3", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>{acctStats.map(a => {
                const isMisc = (acctMap[a.name] || miscCode) === miscCode;
                return (
                  <tr key={a.name} style={{ borderTop: "1px solid #F3F4F6", background: isMisc ? "#FFFAEB" : "#FFFFFF" }}>
                    <td style={{ padding: "9px 14px", fontWeight: 500 }}>{a.name}{isMisc && <span style={{ fontSize: 10, fontWeight: 700, color: "#B54708", marginLeft: 8 }}>review</span>}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", color: "#667085" }}>{a.count}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono',monospace" }}>{money(a.total)}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <select value={acctMap[a.name] || miscCode} onChange={e => setAcctMap(m => ({ ...m, [a.name]: e.target.value }))} style={{ ...sel, width: "100%" }}>
                        <optgroup label="Expenses">{expenseAccts.map(x => <option key={x.code} value={x.code}>{x.code} — {x.name}</option>)}</optgroup>
                        <optgroup label="All accounts">{allAccts.map(x => <option key={x.code} value={x.code}>{x.code} — {x.name}</option>)}</optgroup>
                      </select>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button style={btn(true)} onClick={runImport}>Import {parsed.rows.length.toLocaleString()} transactions →</button>
            <button style={btn(false)} onClick={() => setStep("columns")}>← Back</button>
          </div>
        </div>
      )}

      {/* STEP 5 — Importing */}
      {step === "importing" && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Importing your books…</div>
          <div style={{ height: 12, background: "#F2F4F7", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg,#4F46E5,#6366F1)", borderRadius: 6, transition: "width .2s" }} />
          </div>
          <div style={{ fontSize: 13, color: "#475467", marginTop: 10 }}>{progress}% — booking balanced journal entries, skipping any duplicates.</div>
        </div>
      )}

      {/* STEP 6 — Summary */}
      {step === "summary" && result && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span style={{ width: 36, height: 36, borderRadius: "50%", background: "#039855", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>✓</span>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Import complete</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
            {[["Imported", result.imported.toLocaleString()], ["Total", money(result.total)], ["Duplicates skipped", result.skipped.toLocaleString()], ["Accounts mapped", result.accounts]].map(([k, v]) => (
              <div key={k} style={{ background: "#F9FAFB", border: "1px solid #F0F1F4", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, color: "#475467", marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: "#101828" }}>{v}</div>
              </div>
            ))}
          </div>
          {result.failed > 0 && <div style={{ fontSize: 12.5, color: "#B54708", marginBottom: 14 }}>{result.failed} row{result.failed !== 1 ? "s" : ""} couldn't be imported. {parsed.failed.length > 0 && <span onClick={downloadSkipped} style={{ color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}>Download them →</span>}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={btn(true)} onClick={() => setView("books")}>View your books →</button>
            <button style={btn(false)} onClick={() => { setStep("instructions"); setResult(null); setParsed({ rows: [], failed: [] }); setGrid(null); }}>Import another file</button>
          </div>
        </div>
      )}

      {/* Recent imports + undo (always available) */}
      {recent.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#4F46E5", letterSpacing: 0.5, marginBottom: 6 }}>RECENT IMPORTS</div>
          {recent.map(b => (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: "1px solid #F3F4F6" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: "#101828" }}>{b.filename || "QuickBooks import"}{b.status === "undone" && <span style={{ fontSize: 11, color: "#98A2B3", marginLeft: 8 }}>(undone)</span>}</div>
                <div style={{ fontSize: 11.5, color: "#98A2B3", marginTop: 2 }}>{new Date(b.created_at).toLocaleString()} · {b.imported_count} entries · {money(b.total_amount)}{b.skipped_count ? ` · ${b.skipped_count} skipped` : ""}</div>
              </div>
              {b.status === "undone"
                ? <span style={{ fontSize: 12, color: "#98A2B3" }}>Removed</span>
                : (undoing === b.id
                  ? <span style={{ fontSize: 12, color: "#475467" }}>Undoing…</span>
                  : <button onClick={() => { if (window.confirm(`Undo this import? This soft-deletes all ${b.imported_count} entries from "${b.filename || "the import"}". You can still find them in the audit trail.`)) undoImport(b); }}
                      style={{ fontSize: 12, color: "#D92D20", background: "#FFFFFF", border: "1px solid #D92D2033", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 600 }}>Undo this import</button>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
