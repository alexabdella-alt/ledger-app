import React from "react";
import { useERP } from "./ERPContext";
import { fmtDate } from "../lib/format";
import { callAIProxy } from "../lib/ai";
import { AI_MODEL } from "../lib/constants";

const money = n => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });

// ─────────────────────────────────────────────────────────────────────────────
// Conversational clarification flow.
// Each queued item becomes a chat-style card: a document thumbnail, a plain-English
// recap of what the AI already knows, then one friendly question at a time. After
// the last question we show a summary and a "Confirm & Book" button.
// ─────────────────────────────────────────────────────────────────────────────

// Turn a raw queue item (GL / GAAP / duplicate / AI-question) into a normalized
// conversational session: { kind, knownExcludes, questions[] }.
function deriveSession(item) {
  const inv = item.invoice || {};
  const aiQs = Array.isArray(inv.questions) ? inv.questions : [];

  if (item.gaap) {
    return {
      kind: "gaap",
      questions: [{
        field: "gaap", type: "buttons", prompt: item.question, explanation: item.explanation,
        options: (item.options || []).map(o => ({ label: o.label, value: o })),
      }],
    };
  }

  if (item.isDuplicate) {
    return {
      kind: "duplicate",
      questions: [{
        field: "duplicate", type: "buttons",
        prompt: `This looks like a possible duplicate — invoice ${item.invoice?.invoice_number ? `#${item.invoice.invoice_number} ` : ""}from ${inv.vendor} was already booked${item.existingInvoice?.date ? ` on ${fmtDate(item.existingInvoice.date)}` : ""}. Is this the same charge?`,
        options: [
          { label: "Yes — skip it, already booked", value: "skip" },
          { label: "No, this is a different charge — book it", value: "book" },
        ],
      }],
    };
  }

  // ── Normal GL clarification (also handles revenue confirmation) ──
  // Missing-field questions first, then any plain-English AI questions, then the
  // category question that actually books the entry. Hard cap at 3 questions.
  const pre = [];
  if (!(Number(inv.amount) > 0))
    pre.push({ field: "amount", type: "number", prompt: "I couldn't read the total clearly — what was the amount?", default: inv.amount || "" });
  if (!inv.date)
    pre.push({ field: "date", type: "date", prompt: "What date was this from?", default: new Date().toISOString().slice(0, 10) });
  if (!inv.vendor || inv.vendor === "Unknown")
    pre.push({ field: "vendor", type: "text", prompt: "Who is this receipt from?", default: inv.vendor === "Unknown" ? "" : (inv.vendor || "") });

  const aiMapped = aiQs
    .filter(q => q.field === "business_purpose" || q.field === "personal")
    .map(q => ({ field: q.field, type: "buttons", prompt: q.question, options: (q.options || []).map(o => ({ label: o, value: o })) }));

  const aiCat = aiQs.find(q => q.field === "category");
  // Never surface raw confidence numbers in the conversational UI.
  const cleanedItemQ = item.question ? item.question.replace(/\(\s*\d+%\s*confident\s*\)/gi, "").replace(/\s{2,}/g, " ").trim() : null;
  const catPrompt = aiCat?.question || cleanedItemQ || `How would you categorize this ${inv.vendor || "expense"}?`;
  const catOptions = (item.options || []).map(o => ({
    label: (o.code === item.suggestedCode ? "★ " : "") + o.name, value: o,
  }));
  const catQ = { field: "category", type: "buttons", prompt: catPrompt, options: catOptions };

  let questions = [...pre, ...aiMapped, catQ].slice(0, 3);
  // The category question books the entry, so it must always survive the cap.
  if (!questions.some(q => q.field === "category")) questions = [...questions.slice(0, 2), catQ];

  return { kind: "gl", questions };
}

function ClarificationCard({ item }) {
  const {
    setClarificationQueue, setInvoices, bookToDb, createOrUpdateContact,
    logAudit, showNotification, applyGaapAnswer,
    CHART_OF_ACCOUNTS, addCustomAccount,
  } = useERP();
  const inv = item.invoice || {};
  const session = React.useMemo(() => deriveSession(item), [item]);
  const { kind, questions } = session;

  const [step, setStep] = React.useState(0);
  const [skipped, setSkipped] = React.useState(false);
  const [answers, setAnswers] = React.useState(() => {
    const init = {};
    questions.forEach(q => { if (q.default !== undefined) init[q.field] = q.default; });
    return init;
  });

  // ── Free-text ("describe it in your own words") state ──
  const [freeText, setFreeText] = React.useState("");
  const [interpreting, setInterpreting] = React.useState(false);   // AI thinking
  const [interpretation, setInterpretation] = React.useState(null); // { gl_code, gl_name, reasoning, is_new }
  const [freeError, setFreeError] = React.useState(null);

  const removeFromQueue = () => setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
  const total = questions.length;
  const atSummary = step >= total;

  const setAnswer = (field, value) => setAnswers(a => ({ ...a, [field]: value }));
  const answerAndAdvance = (field, value) => { setAnswers(a => ({ ...a, [field]: value })); setStep(s => s + 1); };

  const isSelected = (field, opt) => {
    const a = answers[field];
    if (a == null) return false;
    if (field === "category") return a?.code === opt.value?.code;
    if (field === "gaap") return a?.label === opt.value?.label;
    return a === opt.value;
  };

  // ── Booking on confirm ──
  const finalize = () => {
    if (kind === "gaap") { applyGaapAnswer(item, answers.gaap); return; }

    if (kind === "duplicate") {
      if (answers.duplicate === "skip") {
        logAudit("invoice_rejected", `Rejected (duplicate): ${inv.vendor} · ${money(inv.amount)} on ${inv.date} — already booked`, inv, null);
        removeFromQueue(); showNotification("Duplicate skipped ✓");
      } else {
        const finalInv = { ...inv, confidence: 100, status: "booked" };
        logAudit("invoice_booked", `${finalInv.vendor} · ${money(finalInv.amount)} → ${finalInv.gl_name} (confirmed — different charge)`, null, { vendor: finalInv.vendor, amount: finalInv.amount, date: finalInv.date, gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
        setInvoices(prev => [finalInv, ...prev]); bookToDb(finalInv);
        if (finalInv._contact) createOrUpdateContact({ ...finalInv._contact, type: finalInv.type === "revenue" ? "customer" : "vendor", gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
        removeFromQueue(); showNotification(`Booked to ${finalInv.gl_name} ✓`);
      }
      return;
    }

    // gl: personal/skip detection from plain-English answers
    const bp = answers.business_purpose, pers = answers.personal;
    const skipPersonal =
      (bp && /personal/i.test(bp) && /don'?t|do not|not|skip/i.test(bp)) ||
      (pers && /^no/i.test(pers));
    if (skipPersonal) {
      logAudit("invoice_rejected", `Skipped (personal): ${inv.vendor} · ${money(inv.amount)} — user marked not a business expense`, inv, null);
      removeFromQueue(); showNotification("Skipped — marked personal ✓");
      return;
    }

    const chosen = answers.category;
    if (!chosen) return;
    doBookGl(chosen);
  };

  // Book a GL-categorized entry. Shared by the pill-selected path (finalize) and
  // the free-text → AI interpretation path (confirmInterpretation).
  const doBookGl = (chosen, { reasoning, audit = "user confirmed" } = {}) => {
    const bp = answers.business_purpose;
    const amt = (answers.amount != null && answers.amount !== "") ? (parseFloat(answers.amount) || inv.amount) : inv.amount;
    const finalInv = {
      ...inv,
      amount: amt,
      date: answers.date || inv.date,
      vendor: answers.vendor || inv.vendor,
      gl_code: chosen.code, gl_name: chosen.name,
      confidence: 100, status: "booked", booked_at: new Date().toISOString(),
      ...(chosen.typeOverride || {}),
      ...(reasoning ? { reasoning } : {}),
    };
    if (bp && /project/i.test(bp)) finalInv.notes = (finalInv.notes ? finalInv.notes + " · " : "") + "Project expense";
    if (answers.vendor) finalInv._contact = { ...(inv._contact || {}), name: answers.vendor };
    logAudit("invoice_booked", `${finalInv.vendor} · ${money(finalInv.amount)} → ${chosen.name} (${audit})`, null, { vendor: finalInv.vendor, amount: finalInv.amount, date: finalInv.date, gl_code: chosen.code, gl_name: chosen.name });
    setInvoices(prev => [finalInv, ...prev]); bookToDb(finalInv);
    if (finalInv._contact) createOrUpdateContact({ ...finalInv._contact, type: finalInv.type === "revenue" ? "customer" : "vendor", gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
    removeFromQueue(); showNotification(`Booked to ${chosen.name} ✓`);
  };

  // ── Free-text booking ("describe it in your own words") ──
  // Pick a free GL code for a brand-new expense account the user described.
  const pickNewExpenseCode = (suggested) => {
    const used = new Set((CHART_OF_ACCOUNTS || []).map(a => String(a.code)));
    const s = String(suggested || "").trim();
    if (/^[67]\d{3}$/.test(s) && !used.has(s)) return s;
    for (let n = 6510; n <= 6999; n++) if (!used.has(String(n))) return String(n);
    for (let n = 7110; n <= 7999; n++) if (!used.has(String(n))) return String(n);
    return "6999";
  };

  // Send the user's free-text description to the AI and ask it to map the charge
  // to a GL account (or propose a new one). Sets `interpretation` on success.
  const interpretFreeText = async () => {
    const text = freeText.trim();
    if (!text || interpreting) return;
    setFreeError(null); setInterpreting(true);
    try {
      const coa = (CHART_OF_ACCOUNTS || [])
        .filter(a => a.category === "Expenses" || a.category === "Revenue")
        .map(a => `${a.code} - ${a.name}`).join("\n");
      const vendor = answers.vendor || inv.vendor || "an unknown vendor";
      const amt = (answers.amount != null && answers.amount !== "") ? (parseFloat(answers.amount) || inv.amount) : inv.amount;
      const data = await callAIProxy({
        model: AI_MODEL,
        max_tokens: 300,
        system: 'You are an expert bookkeeper. Choose the single best GL account for a transaction based on the user\'s description. Reply with ONLY a JSON object, no prose: {"gl_code":"XXXX","gl_name":"Account name","reasoning":"one short sentence","is_new":false}. Strongly prefer an existing account. If NONE of the existing accounts is a reasonable fit, set "is_new":true, propose a concise new expense account name in gl_name, and leave gl_code as "".',
        messages: [{
          role: "user",
          content: `The user uploaded an invoice from ${vendor} for ${money(amt)}. They described it as: "${text}". Based on this, what GL account should this be booked to from this chart of accounts:\n${coa}\n\nReturn JSON: { gl_code, gl_name, reasoning }`,
        }],
      });
      const raw = (data?.content?.find(b => b.type === "text")?.text || "").replace(/```json|```/g, "").trim();
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : raw);
      if (!parsed.gl_name) throw new Error("no account");
      const code = String(parsed.gl_code || "").trim();
      const known = (CHART_OF_ACCOUNTS || []).some(a => String(a.code) === code);
      setInterpretation({
        gl_code: code,
        gl_name: String(parsed.gl_name).trim(),
        reasoning: parsed.reasoning || "",
        is_new: !!parsed.is_new || !known,
      });
    } catch (e) {
      setFreeError("I couldn't read that — try rephrasing, or pick an option above.");
    }
    setInterpreting(false);
  };

  // User confirmed the AI's interpretation → create the account if new, then book.
  const confirmInterpretation = async () => {
    const interp = interpretation;
    if (!interp || interpreting) return;
    setFreeError(null); setInterpreting(true);
    try {
      let code = interp.gl_code;
      let name = interp.gl_name;
      const existing = (CHART_OF_ACCOUNTS || []).find(a => String(a.code) === String(code));
      if (interp.is_new || !existing) {
        code = pickNewExpenseCode(code);
        const ok = await addCustomAccount({ code, name, category: "Expenses" });
        if (ok === false) throw new Error("account create failed");
      } else {
        name = existing.name; // canonical name
      }
      doBookGl({ code, name }, {
        reasoning: interp.reasoning || `Booked from description: "${freeText.trim()}"`,
        audit: "user described",
      });
      // doBookGl removes the card from the queue; no further state updates needed.
    } catch (e) {
      setFreeError("Couldn't book that — please try again or pick an option above.");
      setInterpreting(false);
    }
  };

  // ── Text helpers ──
  const knownText = () => {
    const asks = f => questions.some(q => q.field === f);
    const docNoun = inv.type === "revenue" ? "an invoice" : "a receipt";
    let s = `I found ${docNoun}`;
    if (!asks("vendor") && inv.vendor && inv.vendor !== "Unknown") s += ` from ${inv.vendor}`;
    if (!asks("amount") && Number(inv.amount) > 0) s += ` for ${money(inv.amount)}`;
    if (!asks("date") && inv.date) s += ` on ${fmtDate(inv.date)}`;
    return s + ".";
  };
  const summaryText = () => {
    if (kind === "gaap") return `Got it — I'll handle this as: ${answers.gaap?.label || "your selection"}.`;
    if (kind === "duplicate") return answers.duplicate === "skip"
      ? "Got it — I'll skip this duplicate. Nothing will be booked."
      : "Got it — I'll book this as a separate charge.";
    const cat = answers.category;
    const v = answers.vendor || inv.vendor;
    const a = (answers.amount != null && answers.amount !== "") ? (parseFloat(answers.amount) || inv.amount) : inv.amount;
    const d = answers.date || inv.date;
    const noun = inv.type === "revenue" ? "revenue" : "expense";
    return `Got it — I'll book this as a ${money(a)} ${cat?.name || ""} ${noun} from ${v}${d ? ` on ${fmtDate(d)}` : ""}.`;
  };

  // ── Styles ──
  const pill = (selected) => ({
    padding: "9px 16px", borderRadius: 20, fontSize: 14, fontWeight: 500, cursor: "pointer", textAlign: "left",
    background: selected ? "#4F46E5" : "#FFFFFF",
    border: `1px solid ${selected ? "#4F46E5" : "#D0D5DD"}`,
    color: selected ? "#FFFFFF" : "#344054",
    transition: "all 0.12s", lineHeight: 1.35,
  });
  const thumb = () => {
    if (item.thumb) return <img src={item.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
    const glyph = (item.mediaType || "").includes("pdf") ? "📄" : inv.type === "revenue" ? "🧾" : "🧾";
    return <div style={{ fontSize: 26 }}>{glyph}</div>;
  };

  // ── Skipped (compact) state ──
  if (skipped) {
    return (
      <div style={{ background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 12, padding: "12px 16px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#B54708", background: "#FEF0C7", border: "1px solid #FEDF89", borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap" }}>Needs info</span>
          <span style={{ fontSize: 13, color: "#475467", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.vendor || "Document"}{Number(inv.amount) > 0 ? ` · ${money(inv.amount)}` : ""}</span>
        </div>
        <button onClick={() => setSkipped(false)} style={{ flexShrink: 0, fontSize: 13, fontWeight: 500, color: "#4F46E5", background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>Resume</button>
      </div>
    );
  }

  const q = questions[step];

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 14, padding: 20, marginBottom: 12, display: "flex", gap: 16 }} className="sc-card">
      {/* Thumbnail */}
      <div style={{ width: 72, height: 88, borderRadius: 10, background: "#F2F4F7", border: "1px solid #E4E7EC", overflow: "clip", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {thumb()}
      </div>

      {/* Conversation */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* What the AI knows */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ width: 22, height: 22, borderRadius: 7, background: "linear-gradient(135deg,#6366F1,#4338CA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>✦</span>
          <span style={{ fontSize: 13.5, color: "#475467" }}>{knownText()}</span>
        </div>

        {!atSummary && q ? (
          <>
            {total > 1 && (
              <div style={{ fontSize: 11, color: "#98A2B3", fontWeight: 600, letterSpacing: 0.4, margin: "12px 0 6px" }}>QUESTION {step + 1} OF {total}</div>
            )}
            <div style={{ fontSize: 16, fontWeight: 500, color: "#101828", margin: total > 1 ? "0 0 12px" : "12px 0", lineHeight: 1.45 }}>{q.prompt}</div>
            {q.explanation && (
              <div style={{ fontSize: 12.5, color: "#4338CA", background: "#F5F3FF", border: "1px solid #C7D2FE", borderRadius: 10, padding: "10px 12px", lineHeight: 1.55, marginBottom: 12 }}>{q.explanation}</div>
            )}

            {q.type === "buttons" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {q.options.map((opt, oi) => {
                  const sel = isSelected(q.field, opt);
                  return (
                    <button key={oi} onClick={() => answerAndAdvance(q.field, opt.value)} style={pill(sel)}
                      onMouseEnter={e => { if (!sel) { e.currentTarget.style.background = "#F5F3FF"; e.currentTarget.style.borderColor = "#A5B4FC"; } }}
                      onMouseLeave={e => { if (!sel) { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.borderColor = "#D0D5DD"; } }}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Free-text: describe it in your own words → AI maps to a GL account */}
            {q.type === "buttons" && kind === "gl" && q.field === "category" && (
              <div style={{ marginTop: 14 }}>
                {interpretation ? (
                  /* AI interpreted the description — confirm before booking */
                  <div style={{ background: "#F5F3FF", border: "1px solid #C7D2FE", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: 14.5, color: "#101828", lineHeight: 1.5 }}>
                      Got it — I'll book this as <strong>{interpretation.gl_name}</strong>
                      {interpretation.is_new && <span style={{ fontSize: 12, fontWeight: 600, color: "#4338CA", background: "#E0E7FF", borderRadius: 6, padding: "1px 7px", marginLeft: 6 }}>new account</span>}. Does that look right?
                    </div>
                    {interpretation.reasoning && (
                      <div style={{ fontSize: 12.5, color: "#475467", marginTop: 5, lineHeight: 1.5 }}>{interpretation.reasoning}</div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
                      <button onClick={confirmInterpretation} disabled={interpreting}
                        style={{ height: 38, padding: "0 18px", borderRadius: 8, fontSize: 14, fontWeight: 600, color: "#fff", background: interpreting ? "#A7F3D0" : "#039855", border: "none", cursor: interpreting ? "default" : "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                        {interpreting && <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid rgba(255,255,255,0.5)", borderTopColor: "#fff", borderRadius: "50%", animation: "scSpin 0.7s linear infinite" }} />}
                        {interpreting ? "Booking…" : "Confirm & Book"}
                      </button>
                      <button onClick={() => { setInterpretation(null); setFreeError(null); }} disabled={interpreting}
                        style={{ fontSize: 13, fontWeight: 500, color: "#4F46E5", background: "none", border: "none", cursor: interpreting ? "default" : "pointer", padding: 0 }}>Edit</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <input
                      type="text" value={freeText}
                      onChange={e => setFreeText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); interpretFreeText(); } }}
                      disabled={interpreting}
                      placeholder="Or describe it in your own words..."
                      style={{ flex: "1 1 260px", minWidth: 0, height: 42, boxSizing: "border-box", background: interpreting ? "#F9FAFB" : "#FFFFFF", border: "1px solid #D0D5DD", borderRadius: 10, padding: "0 14px", fontSize: 14, color: "#101828", outline: "none" }} />
                    <button onClick={interpretFreeText} disabled={interpreting || !freeText.trim()}
                      style={{ height: 42, padding: "0 16px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "#fff", background: (interpreting || !freeText.trim()) ? "#C7D2FE" : "#4F46E5", border: "none", cursor: (interpreting || !freeText.trim()) ? "default" : "pointer", display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
                      {interpreting && <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid rgba(255,255,255,0.5)", borderTopColor: "#fff", borderRadius: "50%", animation: "scSpin 0.7s linear infinite" }} />}
                      {interpreting ? "Thinking…" : "Use this →"}
                    </button>
                  </div>
                )}
                {freeError && <div style={{ fontSize: 12.5, color: "#D92D20", marginTop: 8 }}>{freeError}</div>}
              </div>
            )}

            {q.type === "number" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#98A2B3", fontSize: 18, pointerEvents: "none" }}>$</span>
                  <input type="number" inputMode="decimal" autoFocus value={answers[q.field] ?? ""} onChange={e => setAnswer(q.field, e.target.value)}
                    placeholder="0.00"
                    style={{ width: 200, height: 48, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #D0D5DD", borderRadius: 10, padding: "0 14px 0 30px", fontSize: 20, fontWeight: 600, color: "#101828", outline: "none" }} />
                </div>
                <button disabled={!(answers[q.field] !== "" && answers[q.field] != null)} onClick={() => setStep(s => s + 1)}
                  style={{ height: 48, padding: "0 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "#fff", background: (answers[q.field] !== "" && answers[q.field] != null) ? "#4F46E5" : "#C7D2FE", border: "none", cursor: (answers[q.field] !== "" && answers[q.field] != null) ? "pointer" : "default" }}>Continue →</button>
              </div>
            )}

            {q.type === "date" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <input type="date" autoFocus value={answers[q.field] || ""} onChange={e => setAnswer(q.field, e.target.value)}
                  style={{ height: 48, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #D0D5DD", borderRadius: 10, padding: "0 14px", fontSize: 15, color: "#101828", outline: "none" }} />
                <button onClick={() => setStep(s => s + 1)} style={{ height: 48, padding: "0 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "#fff", background: "#4F46E5", border: "none", cursor: "pointer" }}>Continue →</button>
              </div>
            )}

            {q.type === "text" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <input type="text" autoFocus value={answers[q.field] ?? ""} onChange={e => setAnswer(q.field, e.target.value)}
                  placeholder="Vendor name"
                  style={{ width: 260, height: 48, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #D0D5DD", borderRadius: 10, padding: "0 14px", fontSize: 15, color: "#101828", outline: "none" }} />
                <button disabled={!String(answers[q.field] || "").trim()} onClick={() => setStep(s => s + 1)}
                  style={{ height: 48, padding: "0 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "#fff", background: String(answers[q.field] || "").trim() ? "#4F46E5" : "#C7D2FE", border: "none", cursor: String(answers[q.field] || "").trim() ? "pointer" : "default" }}>Continue →</button>
              </div>
            )}

            {/* Back + Skip */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
              {step > 0 && (
                <button onClick={() => setStep(s => s - 1)} style={{ fontSize: 13, color: "#475467", background: "none", border: "none", cursor: "pointer", padding: 0 }}>← Back</button>
              )}
              <button onClick={() => setSkipped(true)} style={{ fontSize: 13, color: "#98A2B3", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Skip for now</button>
            </div>
          </>
        ) : (
          /* ── Summary ── */
          <>
            <div style={{ fontSize: 16, fontWeight: 500, color: "#101828", margin: "12px 0 14px", lineHeight: 1.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: "#039855", flexShrink: 0 }}>✓</span><span>{summaryText()}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <button onClick={finalize} style={{ height: 40, padding: "0 20px", borderRadius: 8, fontSize: 14, fontWeight: 600, color: "#fff", background: kind === "duplicate" && answers.duplicate === "skip" ? "#475467" : "#039855", border: "none", cursor: "pointer" }}>
                {kind === "duplicate" && answers.duplicate === "skip" ? "Confirm & Skip" : "Confirm & Book"}
              </button>
              <button onClick={() => setStep(0)} style={{ fontSize: 13, fontWeight: 500, color: "#4F46E5", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Edit</button>
              <button onClick={() => setSkipped(true)} style={{ fontSize: 13, color: "#98A2B3", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Skip for now</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ClarificationFlow() {
  const { clarificationQueue } = useERP();
  if (!clarificationQueue || clarificationQueue.length === 0) return null;
  return (
    <div id="clarification-section" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#6366F1,#4338CA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#fff", flexShrink: 0 }}>✦</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#101828" }}>A few quick questions</div>
          <div style={{ fontSize: 13, color: "#475467", marginTop: 1 }}>{clarificationQueue.length} {clarificationQueue.length === 1 ? "item needs" : "items need"} a quick answer before I book {clarificationQueue.length === 1 ? "it" : "them"}.</div>
        </div>
      </div>
      {clarificationQueue.map(item => <ClarificationCard key={item.id} item={item} />)}
    </div>
  );
}
