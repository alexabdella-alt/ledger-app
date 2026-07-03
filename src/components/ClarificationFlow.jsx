import React from "react";
import { useERP } from "./ERPContext";
import { fmtDate } from "../lib/format";
import { callAIProxy } from "../lib/ai";

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
    const ex = item.existingInvoice || {};
    const exAmt = Number(ex.amount);
    return {
      kind: "duplicate",
      questions: [{
        field: "duplicate", type: "buttons",
        prompt: `This looks like it might be a duplicate. I found a similar entry${ex.date ? ` from ${fmtDate(ex.date)}` : ""} for ${inv.vendor}${Number.isFinite(exAmt) ? ` — ${money(exAmt)}` : ""}. Is this a new charge or the same one?`,
        options: [
          { label: "New charge — book it", value: "book" },
          { label: "Same invoice — skip it", value: "skip" },
          { label: "Not sure — let me check", value: "unsure" },
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
  // O75 correction UX — let the user override the fundamental type/direction on ANY
  // clarification (not just the sub-detail), and re-route to type-appropriate questions
  // so we never ask a follow-up (e.g. prepaid period) on top of a wrong premise.
  const [correctedType, setCorrectedType] = React.useState(null);
  const baseInv = item.invoice || {};
  const effType = correctedType || baseInv.type;
  const effItem = React.useMemo(() => {
    if (!correctedType || correctedType === baseInv.type) return item;
    const isRev = correctedType === "revenue";
    const acct = (CHART_OF_ACCOUNTS || []).find(a => a.category === (isRev ? "Revenue" : "Expenses")) || {};
    const effInv = {
      ...baseInv, type: correctedType,
      gl_code: acct.code, gl_name: acct.name,
      secondary_gl_code: isRev ? "1100" : "2000",
      secondary_gl_name: isRev ? "Accounts Receivable" : "Accounts Payable",
      debit_credit: isRev ? "credit" : "debit",
      questions: [],
    };
    // Drop the old (wrong-premise) framing: no duplicate/gaap branch, ask a fresh,
    // type-correct category question.
    return {
      ...item, invoice: effInv, gaap: undefined, isDuplicate: undefined, existingInvoice: undefined,
      question: `How would you categorize this ${isRev ? "revenue" : "expense"}?`,
      options: (CHART_OF_ACCOUNTS || []).filter(a => a.category === (isRev ? "Revenue" : "Expenses")).slice(0, 6).map(a => ({ code: a.code, name: a.name })),
      suggestedCode: effInv.gl_code, suggestedName: effInv.gl_name,
    };
  }, [correctedType, item, baseInv, CHART_OF_ACCOUNTS]);
  const inv = effItem.invoice || {};
  const session = React.useMemo(() => deriveSession(effItem), [effItem]);
  const { kind, questions } = session;

  const [step, setStep] = React.useState(0);
  // When the user flips the type, restart the (now type-correct) questions from the top.
  React.useEffect(() => { setStep(0); }, [correctedType]);
  const [skipped, setSkipped] = React.useState(false);
  const [answers, setAnswers] = React.useState(() => {
    const init = {};
    questions.forEach(q => { if (q.default !== undefined) init[q.field] = q.default; });
    return init;
  });

  // ── Free-text ("describe it in your own words") state ──
  const [freeText, setFreeText] = React.useState("");
  const [interpreting, setInterpreting] = React.useState(false);   // AI thinking
  const [freeError, setFreeError] = React.useState(null);
  // ── Depreciation capture (GAAP capitalize option) — life (yrs) + salvage + in-service ──
  const depOpt = answers.gaap && answers.gaap.depreciate ? answers.gaap : null;
  const [depLifeYears, setDepLifeYears] = React.useState("");
  const [depSalvage, setDepSalvage] = React.useState("0");
  const [depInService, setDepInService] = React.useState("");
  React.useEffect(() => {
    if (depOpt) {
      setDepLifeYears(String(Math.max(1, Math.round((depOpt.usefulLifeMonths || 60) / 12))));   // AI-suggested default, overridable
      setDepInService(inv.date || new Date().toISOString().slice(0, 10));
      setDepSalvage("0");
    }
  }, [depOpt]);
  // ── Post-booking success state (the booking itself is the confirmation) ──
  const [done, setDone] = React.useState(null);                    // { text, tone } | null
  const removeTimer = React.useRef(null);
  React.useEffect(() => () => { if (removeTimer.current) clearTimeout(removeTimer.current); }, []);

  const removeFromQueue = () => setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
  // Book immediately, then show a brief "✓ Booked" state before the card drops out.
  // Flag the item resolved right away so the badge, the review banner, and the upload
  // queue's "Needs your input" status all update instantly (the card itself lingers a
  // moment to show the success state, then is removed entirely).
  const finishWithSuccess = (text, tone = "success") => {
    setDone({ text, tone });
    setClarificationQueue(prev => prev.map(c => c.id === item.id ? { ...c, resolved: true } : c));
    removeTimer.current = setTimeout(() => removeFromQueue(), 1900);
  };
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

  // ── Booking ──
  // GAAP keeps a brief one-line summary (financial-statement impact) → confirm.
  // Everything else books on the spot; the success state is the confirmation.
  const finalize = () => {
    if (kind === "gaap") {
      const sel = answers.gaap;
      if (sel && sel.depreciate) {
        const months = Math.max(1, Math.round((parseFloat(depLifeYears) || 5) * 12));
        applyGaapAnswer(item, { ...sel, usefulLifeMonths: months, salvageValue: parseFloat(depSalvage) || 0, inServiceDate: depInService || inv.date });
      } else {
        applyGaapAnswer(item, sel);
      }
      return;
    }
  };

  // A pill answer was clicked. Decide whether to book now or advance a step.
  const onPill = (field, value) => {
    if (done) return; // already booking
    if (kind === "gaap") { answerAndAdvance(field, value); return; }       // → summary
    if (kind === "duplicate") { setAnswer(field, value); bookDuplicate(value); return; }
    // gl kind
    if (field === "category") { setAnswer(field, value); doBookGl(value); return; }
    if (field === "business_purpose" || field === "personal") {
      setAnswer(field, value);
      if (isPersonalSkip(field, value)) { rejectPersonal(); return; }
      setStep(s => s + 1); return;
    }
    answerAndAdvance(field, value);
  };

  const isPersonalSkip = (field, value) => {
    const v = String(value || "");
    if (field === "business_purpose") return /personal/i.test(v) && /don'?t|do not|not|skip/i.test(v);
    if (field === "personal") return /^\s*no/i.test(v);
    return false;
  };

  const rejectPersonal = () => {
    logAudit("invoice_rejected", `Skipped (personal): ${inv.vendor} · ${money(inv.amount)} — user marked not a business expense`, inv, null);
    finishWithSuccess("Skipped — marked personal", "muted");
  };

  const bookDuplicate = (value) => {
    if (value === "skip") {
      // Same invoice — don't book it. Log to the audit trail as duplicate_skipped.
      logAudit("duplicate_skipped", `Skipped duplicate: ${inv.vendor} · ${money(inv.amount)}${inv.date ? ` on ${inv.date}` : ""} — same as an existing entry`, inv, null);
      finishWithSuccess("Skipped — duplicate", "muted");
    } else if (value === "unsure") {
      // Not sure — book it but flag for review so it surfaces in the review queue.
      const finalInv = { ...inv, confidence: 100, status: "booked", approval_status: "flagged", duplicate_flag: true, duplicate_reason: "Possible duplicate — user wasn't sure" };
      logAudit("invoice_booked", `${finalInv.vendor} · ${money(finalInv.amount)} → ${finalInv.gl_name} (flagged: possible duplicate — needs review)`, null, { vendor: finalInv.vendor, amount: finalInv.amount, date: finalInv.date, gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
      setInvoices(prev => [finalInv, ...prev]); bookToDb(finalInv);
      if (finalInv._contact) createOrUpdateContact({ ...finalInv._contact, type: finalInv.type === "revenue" ? "customer" : "vendor", gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
      finishWithSuccess("Booked — flagged as possible duplicate");
    } else {
      // New charge — book it normally.
      const finalInv = { ...inv, confidence: 100, status: "booked" };
      logAudit("invoice_booked", `${finalInv.vendor} · ${money(finalInv.amount)} → ${finalInv.gl_name} (confirmed — different charge)`, null, { vendor: finalInv.vendor, amount: finalInv.amount, date: finalInv.date, gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
      setInvoices(prev => [finalInv, ...prev]); bookToDb(finalInv);
      if (finalInv._contact) createOrUpdateContact({ ...finalInv._contact, type: finalInv.type === "revenue" ? "customer" : "vendor", gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
      finishWithSuccess(`Booked to ${finalInv.gl_name}`);
    }
  };

  // Book a GL-categorized entry. Shared by the pill-selected path and the
  // free-text → AI interpretation path.
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
    finishWithSuccess(`Booked to ${chosen.name}`);
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

  // Send the user's free-text description to the AI, map it to a GL account
  // (creating a new one if nothing fits), then book immediately — no confirm step.
  const interpretFreeText = async () => {
    const text = freeText.trim();
    if (!text || interpreting || done) return;
    setFreeError(null); setInterpreting(true);
    try {
      const coa = (CHART_OF_ACCOUNTS || [])
        .filter(a => a.category === "Expenses" || a.category === "Revenue")
        .map(a => `${a.code} - ${a.name}`).join("\n");
      const vendor = answers.vendor || inv.vendor || "an unknown vendor";
      const amt = (answers.amount != null && answers.amount !== "") ? (parseFloat(answers.amount) || inv.amount) : inv.amount;
      const data = await callAIProxy({
        profile: "interpret-freetext-gl",   // model/max_tokens/system server-owned; vendor + user description + chart via untrusted slots
        slots: {
          CONTEXT: `The user uploaded an invoice from ${vendor} for ${money(amt)}. They described it as: "${text}".`,
          CHART: coa,
        },
        messages: [{
          role: "user",
          content: "Choose the best GL account for the transaction described in the instructions. Return JSON: { gl_code, gl_name, reasoning }.",
        }],
      });
      const raw = (data?.content?.find(b => b.type === "text")?.text || "").replace(/```json|```/g, "").trim();
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : raw);
      if (!parsed.gl_name) throw new Error("no account");
      let code = String(parsed.gl_code || "").trim();
      let name = String(parsed.gl_name).trim();
      const existing = (CHART_OF_ACCOUNTS || []).find(a => String(a.code) === code);
      if (!!parsed.is_new || !existing) {
        code = pickNewExpenseCode(code);
        const ok = await addCustomAccount({ code, name, category: "Expenses" });
        if (ok === false) throw new Error("account create failed");
      } else {
        name = existing.name; // canonical name
      }
      doBookGl({ code, name }, {
        reasoning: parsed.reasoning || `Booked from description: "${text}"`,
        audit: "user described",
      });
      // doBookGl switches the card to its success state; no further updates needed.
    } catch (e) {
      setFreeError("I couldn't read that — try rephrasing, or pick an option above.");
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
    background: selected ? "var(--sc-gold)" : "var(--sc-surface)",
    border: `1px solid ${selected ? "var(--sc-gold)" : "var(--sc-border-2)"}`,
    color: selected ? "var(--sc-surface)" : "var(--sc-text-2)",
    transition: "all 0.12s", lineHeight: 1.35,
  });
  const thumb = () => {
    if (item.thumb) return <img src={item.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
    const glyph = (item.mediaType || "").includes("pdf") ? "📄" : inv.type === "revenue" ? "🧾" : "🧾";
    return <div style={{ fontSize: 26 }}>{glyph}</div>;
  };

  // ── Booked / done (compact success) state ──
  if (done) {
    const ok = done.tone === "success";
    return (
      <div style={{ background: "var(--sc-surface)", border: `1px solid ${ok ? "var(--sc-success-soft)" : "var(--sc-border)"}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }} className="sc-card">
        <span style={{ width: 22, height: 22, borderRadius: "50%", background: ok ? "var(--sc-success)" : "var(--sc-text-mut)", color: "var(--sc-on-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>✓</span>
        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--sc-text)" }}>{done.text}</span>
      </div>
    );
  }

  // ── Skipped (compact) state ──
  if (skipped) {
    return (
      <div style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 12, padding: "12px 16px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--sc-warning)", background: "var(--sc-warning-soft)", border: "1px solid var(--sc-warning-soft)", borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap" }}>Needs info</span>
          <span style={{ fontSize: 13, color: "var(--sc-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.vendor || "Document"}{Number(inv.amount) > 0 ? ` · ${money(inv.amount)}` : ""}</span>
        </div>
        <button onClick={() => setSkipped(false)} style={{ flexShrink: 0, fontSize: 13, fontWeight: 500, color: "var(--sc-gold)", background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold)", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>Resume</button>
      </div>
    );
  }

  const q = questions[step];

  return (
    <div style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: 20, marginBottom: 12, display: "flex", gap: 16 }} className="sc-card">
      {/* Thumbnail */}
      <div style={{ width: 72, height: 88, borderRadius: 10, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border)", overflow: "clip", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {thumb()}
      </div>

      {/* Conversation */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* What the AI knows */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ width: 22, height: 22, borderRadius: 7, background: "linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>✦</span>
          <span style={{ fontSize: 13, color: "var(--sc-text-2)" }}>{knownText()}</span>
        </div>

        {!atSummary && q ? (
          <>
            {total > 1 && (
              <div style={{ fontSize: 11, color: "var(--sc-text-mut)", fontWeight: 600, letterSpacing: 0.4, margin: "12px 0 6px" }}>QUESTION {step + 1} OF {total}</div>
            )}
            <div style={{ fontSize: 16, fontWeight: 500, color: "var(--sc-text)", margin: total > 1 ? "0 0 12px" : "12px 0", lineHeight: 1.45 }}>{q.prompt}</div>
            {q.explanation && (
              <div style={{ fontSize: 13, color: "var(--sc-gold)", background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold)", borderRadius: 10, padding: "10px 12px", lineHeight: 1.55, marginBottom: 12 }}>{q.explanation}</div>
            )}

            {q.type === "buttons" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {q.options.map((opt, oi) => {
                  const sel = isSelected(q.field, opt);
                  return (
                    <button key={oi} onClick={() => onPill(q.field, opt.value)} style={pill(sel)}
                      onMouseEnter={e => { if (!sel) { e.currentTarget.style.background = "var(--sc-gold-soft)"; e.currentTarget.style.borderColor = "var(--sc-gold)"; } }}
                      onMouseLeave={e => { if (!sel) { e.currentTarget.style.background = "var(--sc-surface)"; e.currentTarget.style.borderColor = "var(--sc-border-2)"; } }}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Free-text: describe it in your own words → AI maps to a GL account
                and books immediately (no confirmation step). */}
            {q.type === "buttons" && kind === "gl" && q.field === "category" && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="text" value={freeText}
                    onChange={e => setFreeText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); interpretFreeText(); } }}
                    disabled={interpreting}
                    placeholder="Or describe it in your own words..."
                    style={{ flex: "1 1 260px", minWidth: 0, height: 42, boxSizing: "border-box", background: interpreting ? "var(--sc-bg)" : "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 10, padding: "0 14px", fontSize: 14, color: "var(--sc-text)", outline: "none" }} />
                  <button onClick={interpretFreeText} disabled={interpreting || !freeText.trim()}
                    style={{ height: 42, padding: "0 16px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "var(--sc-on-accent)", background: (interpreting || !freeText.trim()) ? "var(--sc-gold)" : "var(--sc-gold)", border: "none", cursor: (interpreting || !freeText.trim()) ? "default" : "pointer", display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
                    {interpreting && <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid rgba(255,255,255,0.5)", borderTopColor: "var(--sc-surface)", borderRadius: "50%", animation: "scSpin 0.7s linear infinite" }} />}
                    {interpreting ? "Booking…" : "Use this →"}
                  </button>
                </div>
                {freeError && <div style={{ fontSize: 13, color: "var(--sc-error)", marginTop: 8 }}>{freeError}</div>}
              </div>
            )}

            {q.type === "number" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--sc-text-mut)", fontSize: 18, pointerEvents: "none" }}>$</span>
                  <input type="number" inputMode="decimal" autoFocus value={answers[q.field] ?? ""} onChange={e => setAnswer(q.field, e.target.value)}
                    placeholder="0.00"
                    style={{ width: 200, height: 48, boxSizing: "border-box", background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 10, padding: "0 14px 0 30px", fontSize: 20, fontWeight: 600, color: "var(--sc-text)", outline: "none" }} />
                </div>
                <button disabled={!(answers[q.field] !== "" && answers[q.field] != null)} onClick={() => setStep(s => s + 1)}
                  style={{ height: 48, padding: "0 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "var(--sc-on-accent)", background: (answers[q.field] !== "" && answers[q.field] != null) ? "var(--sc-gold)" : "var(--sc-gold)", border: "none", cursor: (answers[q.field] !== "" && answers[q.field] != null) ? "pointer" : "default" }}>Continue →</button>
              </div>
            )}

            {q.type === "date" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <input type="date" autoFocus value={answers[q.field] || ""} onChange={e => setAnswer(q.field, e.target.value)}
                  style={{ height: 48, boxSizing: "border-box", background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 10, padding: "0 14px", fontSize: 15, color: "var(--sc-text)", outline: "none" }} />
                <button onClick={() => setStep(s => s + 1)} style={{ height: 48, padding: "0 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "var(--sc-on-accent)", background: "var(--sc-gold)", border: "none", cursor: "pointer" }}>Continue →</button>
              </div>
            )}

            {q.type === "text" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <input type="text" autoFocus value={answers[q.field] ?? ""} onChange={e => setAnswer(q.field, e.target.value)}
                  placeholder="Vendor name"
                  style={{ width: 260, height: 48, boxSizing: "border-box", background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 10, padding: "0 14px", fontSize: 15, color: "var(--sc-text)", outline: "none" }} />
                <button disabled={!String(answers[q.field] || "").trim()} onClick={() => setStep(s => s + 1)}
                  style={{ height: 48, padding: "0 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "var(--sc-on-accent)", background: String(answers[q.field] || "").trim() ? "var(--sc-gold)" : "var(--sc-gold)", border: "none", cursor: String(answers[q.field] || "").trim() ? "pointer" : "default" }}>Continue →</button>
              </div>
            )}

            {/* Back + Skip */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
              {step > 0 && (
                <button onClick={() => setStep(s => s - 1)} style={{ fontSize: 13, color: "var(--sc-text-2)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>← Back</button>
              )}
              <button onClick={() => setSkipped(true)} style={{ fontSize: 13, color: "var(--sc-text-mut)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Skip for now</button>
            </div>
          </>
        ) : (
          /* ── Summary (GAAP only — brief, since it has financial-statement impact) ── */
          <>
            <div style={{ fontSize: 16, fontWeight: 500, color: "var(--sc-text)", margin: "12px 0 14px", lineHeight: 1.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: "var(--sc-success)", flexShrink: 0 }}>✓</span><span>{summaryText()}</span>
            </div>
            {depOpt && (
              <div style={{ background: "var(--sc-bg)", border: "1px solid var(--sc-border)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: 1, fontWeight: 600, color: "var(--sc-text-2)", marginBottom: 10 }}>DEPRECIATION SCHEDULE · STRAIGHT-LINE</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 13, color: "var(--sc-text-2)", display: "flex", flexDirection: "column", gap: 4 }}>
                    Useful life (years)
                    <input type="number" min="1" step="1" value={depLifeYears} onChange={e => setDepLifeYears(e.target.value)}
                      style={{ width: 110, height: 36, borderRadius: 8, border: "1px solid var(--sc-border-2)", padding: "0 10px", fontSize: 14 }} />
                  </label>
                  <label style={{ fontSize: 13, color: "var(--sc-text-2)", display: "flex", flexDirection: "column", gap: 4 }}>
                    Salvage value ($)
                    <input type="number" min="0" step="0.01" value={depSalvage} onChange={e => setDepSalvage(e.target.value)}
                      style={{ width: 130, height: 36, borderRadius: 8, border: "1px solid var(--sc-border-2)", padding: "0 10px", fontSize: 14 }} />
                  </label>
                  <label style={{ fontSize: 13, color: "var(--sc-text-2)", display: "flex", flexDirection: "column", gap: 4 }}>
                    In-service date
                    <input type="date" value={depInService} onChange={e => setDepInService(e.target.value)}
                      style={{ height: 36, borderRadius: 8, border: "1px solid var(--sc-border-2)", padding: "0 10px", fontSize: 14 }} />
                  </label>
                </div>
                <div style={{ fontSize: 12, color: "var(--sc-text-mut)", marginTop: 8 }}>Life prefilled from the asset type — adjust if needed. Salvage defaults to $0.</div>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <button onClick={finalize} style={{ height: 40, padding: "0 20px", borderRadius: 8, fontSize: 14, fontWeight: 600, color: "var(--sc-on-accent)", background: "var(--sc-success)", border: "none", cursor: "pointer" }}>Confirm & Book</button>
              <button onClick={() => setStep(0)} style={{ fontSize: 13, fontWeight: 500, color: "var(--sc-gold)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Edit</button>
              <button onClick={() => setSkipped(true)} style={{ fontSize: 13, color: "var(--sc-text-mut)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Skip for now</button>
            </div>
          </>
        )}

        {/* O75 — type/direction override, consistently available on EVERY clarification.
            Lets the user correct the fundamental classification (not just the sub-detail)
            and re-routes to type-correct questions instead of locking in a wrong premise. */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--sc-border)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--sc-text-mut)" }}>Wrong type?</span>
          {[["revenue", "This is revenue"], ["expense", "This is an expense"]].map(([t, label]) => {
            const active = effType === t;
            return (
              <button key={t} onClick={() => { if (!active && !done) setCorrectedType(t); }} disabled={active || !!done}
                style={{ fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 7, cursor: active || done ? "default" : "pointer",
                  background: active ? "var(--sc-gold-soft)" : "transparent", color: active ? "var(--sc-gold)" : "var(--sc-text-2)",
                  border: `1px solid ${active ? "var(--sc-gold-line)" : "var(--sc-border-2)"}` }}>
                {active ? "✓ " : ""}{label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ClarificationFlow() {
  const { clarificationQueue } = useERP();
  if (!clarificationQueue || clarificationQueue.length === 0) return null;
  // Count only items still awaiting an answer (resolved ones linger briefly to show
  // their "✓ Booked" success state before they're removed from the queue entirely).
  const pending = clarificationQueue.filter(c => !c.resolved).length;
  return (
    <div id="clarification-section" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "var(--sc-on-accent)", flexShrink: 0 }}>✦</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--sc-text)" }}>A few quick questions</div>
          <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 1 }}>{pending > 0 ? `${pending} ${pending === 1 ? "item needs" : "items need"} a quick answer before I book ${pending === 1 ? "it" : "them"}.` : "All caught up ✓"}</div>
        </div>
      </div>
      {clarificationQueue.map(item => <ClarificationCard key={item.id} item={item} />)}
    </div>
  );
}
