import React from "react";
import { useERP } from "./ERPContext";
import { buildTeachInTable, planTeachIn, DECISION } from "../lib/vendorTeachIn";
import { fmtMoney } from "../lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// C563 — VENDOR TEACH-IN. Upload two or three old bank statements; we list every vendor you
// paid with the category we'd use; you confirm it once; each confirmed vendor becomes a rule,
// so their future bills file themselves. LEARN ONLY: nothing on these statements is recorded
// (they predate your books' start date), and the files are not kept.
// The logic is pure and tested in lib/vendorTeachIn.js; this file is the screen.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_FILES = 3;
const ACCEPT = ".pdf,.csv,.xlsx,.xls,.txt";

export default function VendorTeachIn({ onClose }) {
  const { readBankStatement, saveVendorRule, BOOKABLE_ACCOUNTS, rules, aliasIndex, getAccountByRole, logAudit, userRole, showNotification } = useERP();
  const [step, setStep] = React.useState("pick");          // pick | reading | review | saving | done
  const [files, setFiles] = React.useState([]);
  const [progress, setProgress] = React.useState("");
  const [readErrors, setReadErrors] = React.useState([]);
  const [table, setTable] = React.useState({ rows: [], alreadyRuled: 0 });
  const [decisions, setDecisions] = React.useState({});
  const [result, setResult] = React.useState(null);

  const bookable = BOOKABLE_ACCOUNTS || [];
  const ownersDraw = getAccountByRole?.("owners_draw") || null;
  const plan = planTeachIn(table.rows, decisions, { bookable, ownersDraw });

  const pick = (list) => {
    const chosen = Array.from(list || []).slice(0, MAX_FILES);
    setFiles(chosen);
  };

  const read = async () => {
    setStep("reading"); setReadErrors([]);
    const lines = [], errors = [];
    for (let i = 0; i < files.length; i++) {
      setProgress(`Reading statement ${i + 1} of ${files.length}…`);
      try {
        const { categorized } = await readBankStatement(files[i]);
        lines.push(...(categorized || []));
      } catch (e) {
        errors.push({ name: files[i].name, why: String(e?.message || e || "we couldn't read it") });
      }
    }
    const t = buildTeachInTable(lines, { rules, aliasIndex, bookable });
    setTable(t);
    setDecisions(Object.fromEntries(t.rows.map((r) => [r.key, r.decision])));
    setReadErrors(errors);
    setStep("review");
  };

  const save = async () => {
    setStep("saving");
    const saved = [], failed = [];
    for (const r of plan.rules) {
      setProgress(`Saving ${saved.length + failed.length + 1} of ${plan.rules.length}…`);
      try {
        const res = await saveVendorRule({ vendor: r.vendor, gl_code: r.gl_code, gl_name: r.gl_name });
        if (res && res.ok) saved.push(r); else failed.push({ ...r, why: res?.error || "the save didn't go through" });
      } catch (e) { failed.push({ ...r, why: String(e?.message || e) }); }
    }
    // One audit row for the whole teach-in, naming who confirmed it — the owner or their accountant.
    logAudit?.("vendor_teach_in",
      `Learned ${saved.length} vendor${saved.length === 1 ? "" : "s"} from ${files.length} old statement${files.length === 1 ? "" : "s"} (confirmed by the ${userRole || "user"})`
        + (plan.asked.length ? `; ${plan.asked.length} left as "ask each time"` : "")
        + (failed.length ? `; ${failed.length} couldn't be saved` : ""),
      null, { saved: saved.map((r) => ({ vendor: r.vendor, gl_code: r.gl_code })), asked: plan.asked, failed: failed.map((r) => r.vendor), confirmed_by_role: userRole || null });
    setResult({ saved, failed, asked: plan.asked });
    setStep("done");
    if (!failed.length && saved.length) showNotification?.(`Saved ${saved.length} vendor rule${saved.length === 1 ? "" : "s"}.`);
  };

  const setDecision = (key, value) => {
    const d = value === "__ask" ? { kind: DECISION.ASK } : value === "__personal" ? { kind: DECISION.PERSONAL } : { kind: DECISION.CATEGORY, gl_code: value };
    setDecisions((prev) => ({ ...prev, [key]: d }));
  };
  const selectValue = (d) => (!d || d.kind === DECISION.ASK ? "__ask" : d.kind === DECISION.PERSONAL ? "__personal" : d.gl_code);

  const groups = [...new Set(bookable.map((a) => a.category || "Other"))];
  const overlay = { position: "fixed", inset: 0, background: "rgba(16,18,27,0.45)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" };
  const card = { background: "var(--sc-surface)", borderRadius: 16, width: "100%", maxWidth: 820, padding: "22px 24px", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" };
  const btn = { padding: "9px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: "var(--sc-gold)", color: "var(--sc-on-accent)" };
  const ghost = { ...btn, background: "var(--sc-surface)", color: "var(--sc-text-2)", border: "1px solid var(--sc-border-2)" };
  const muted = { fontSize: 13, color: "var(--sc-text-2)", lineHeight: 1.55 };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Teach us your vendors">
      <div style={card}>
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--sc-text)" }}>Teach us your vendors</div>

        {step === "pick" && (
          <div>
            <p style={{ ...muted, marginTop: 8 }}>
              Upload your last two or three bank or card statements. We'll list everyone you paid, how often, and the category we'd use.
              You check it once, and from then on their bills file themselves.
            </p>
            <p style={{ ...muted, marginTop: 4 }}>
              <strong>Nothing on these statements is recorded</strong> — they're from before your books start, so we only learn from them. We don't keep the files.
            </p>
            <input type="file" multiple accept={ACCEPT} onChange={(e) => pick(e.target.files)} style={{ marginTop: 14, fontSize: 13 }} aria-label="Choose statements" />
            {files.length > 0 && <div style={{ ...muted, marginTop: 8 }}>{files.map((f) => f.name).join(" · ")}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button style={ghost} onClick={onClose}>Cancel</button>
              <button style={{ ...btn, opacity: files.length ? 1 : 0.5 }} disabled={!files.length} onClick={read}>Read my statements</button>
            </div>
          </div>
        )}

        {(step === "reading" || step === "saving") && <div style={{ ...muted, marginTop: 14 }}>{progress}</div>}

        {step === "review" && (
          <div>
            {readErrors.map((e) => (
              <div key={e.name} style={{ fontSize: 13, color: "var(--sc-warning)", marginTop: 8 }}>We couldn't read {e.name}: {e.why}</div>
            ))}
            {table.rows.length === 0 ? (
              <p style={{ ...muted, marginTop: 10 }}>
                We didn't find any payments to vendors in {readErrors.length === files.length ? "those files" : "those statements"}
                {table.alreadyRuled ? ` that don't already have a rule (${table.alreadyRuled} do)` : ""}.
              </p>
            ) : (
              <>
                <p style={{ ...muted, marginTop: 8 }}>
                  Here's who you paid. Check the category for each — their future bills will be filed this way.
                  Where a vendor's purchases vary, we've set it to ask each time.
                  {table.alreadyRuled ? ` ${table.alreadyRuled} vendor${table.alreadyRuled === 1 ? " already has a rule" : "s already have rules"} and ${table.alreadyRuled === 1 ? "is" : "are"} left as ${table.alreadyRuled === 1 ? "it is" : "they are"}.` : ""}
                </p>
                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--sc-text-2)" }}>
                        <th style={{ padding: "6px 8px" }}>Vendor</th>
                        <th style={{ padding: "6px 8px" }}>How often</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Usually</th>
                        <th style={{ padding: "6px 8px" }}>File it as</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((r) => (
                        <tr key={r.key} style={{ borderTop: "1px solid var(--sc-surface-2)" }}>
                          <td style={{ padding: "8px" }}>
                            <div style={{ fontWeight: 600, color: "var(--sc-text)" }}>{r.name}</div>
                            {r.otherNames.length > 0 && <div style={{ fontSize: 12, color: "var(--sc-text-mut)" }}>also as {r.otherNames.join(", ")}</div>}
                            {r.mixed && <div style={{ fontSize: 12, color: "var(--sc-text-mut)" }}>Purchases vary — we'll ask each time unless you choose</div>}
                          </td>
                          <td style={{ padding: "8px", color: "var(--sc-text-2)" }}>{r.cadence} · {r.count} payment{r.count === 1 ? "" : "s"}</td>
                          <td style={{ padding: "8px", textAlign: "right", fontFamily: "'DM Mono', monospace" }}>{fmtMoney(r.typical)}</td>
                          <td style={{ padding: "8px" }}>
                            <select value={selectValue(decisions[r.key])} onChange={(e) => setDecision(r.key, e.target.value)}
                              aria-label={`Category for ${r.name}`}
                              style={{ width: "100%", padding: "7px 9px", borderRadius: 8, border: "1px solid var(--sc-border-2)", fontSize: 13, background: "var(--sc-surface)", color: "var(--sc-text)" }}>
                              <option value="__ask">Ask me each time</option>
                              {ownersDraw && <option value="__personal">Personal — not a business expense</option>}
                              {groups.map((g) => (
                                <optgroup key={g} label={g}>
                                  {bookable.filter((a) => (a.category || "Other") === g).map((a) => <option key={a.code} value={String(a.code)}>{a.name}</option>)}
                                </optgroup>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18, flexWrap: "wrap" }}>
              <button style={ghost} onClick={onClose}>Cancel</button>
              {table.rows.length > 0 && (
                <button style={{ ...btn, opacity: plan.rules.length ? 1 : 0.5 }} disabled={!plan.rules.length} onClick={save}>
                  Save {plan.rules.length} vendor rule{plan.rules.length === 1 ? "" : "s"}
                </button>
              )}
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div>
            <p style={{ ...muted, marginTop: 10 }}>
              {result.saved.length
                ? `Saved ${result.saved.length} vendor rule${result.saved.length === 1 ? "" : "s"}. Their bills will now be filed without asking.`
                : "No rules were saved."}
              {result.asked.length ? ` ${result.asked.length} vendor${result.asked.length === 1 ? "" : "s"} will be asked about each time.` : ""}
              {" "}You can change any of them in Settings → Vendor rules.
            </p>
            {result.failed.map((f) => (
              <div key={f.vendor} style={{ fontSize: 13, color: "var(--sc-warning)", marginTop: 6 }}>Couldn't save {f.vendor}: {f.why}</div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button style={btn} onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
