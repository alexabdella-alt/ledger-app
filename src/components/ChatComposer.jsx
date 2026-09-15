import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// THE CHAT BOX OWNS ITS OWN TEXT.
//
// `O107` cause 2: `chatInput` was state on the ROOT component, so **every keystroke
// re-rendered the whole application** — the 407-key context object was rebuilt and every
// mounted view re-rendered with it. That is the mechanism behind "it feels sluggish while I
// use it", as distinct from "it takes a while to load" (cause 1, the serial company load).
//
// ★★ THE FIX IS LOCALITY, NOT MEMOISATION. Memoising a 407-key context needs a complete
// dependency list, and a missed one means silently stale numbers on an accounting screen —
// the worst failure this product can have. Moving the state to the only component that reads
// it has no such failure mode: nothing else could see it, so nothing else can go stale.
//
// ★ IT WAS READ IN EXACTLY ONE PLACE. Every view destructured `chatInput` from context and
// none of them used it — copy-paste, paid for on every keypress.
// ─────────────────────────────────────────────────────────────────────────────

// C444 — the owner's words (C377): "burn rate" is startup vocabulary a restaurant owner never
// uses, and a suggested question teaches the person what the product expects them to say.
const SUGGESTIONS = [
  "How much am I spending each month?",
  "Which bills haven't I paid?",
  "Did I make money this month?",
  "Does anything need my attention?",
];

export default function ChatComposer({ onSend, loading = false, showSuggestions = false, prefill = null }) {
  const [text, setText] = React.useState("");
  const inputRef = React.useRef(null);

  // ★ A BUTTON ELSEWHERE CAN PRE-FILL THE BOX (Reports asks for an analysis). Keyed on the
  // prefill's own timestamp so clicking the same button twice fills it again — a plain string
  // would be ignored the second time, which reads as the button being broken.
  React.useEffect(() => {
    if (!prefill || !prefill.text) return;
    // C404 — Home's "Ask about your books" box (U6) already took an Enter; making the person
    // press it again in the drawer read as "nothing happened". A prefill marked `send` is
    // sent on arrival; if the chat declines (still answering the last one), the text stays
    // in the box exactly as a plain prefill would, so nothing typed is lost.
    if (prefill.send && !loading && onSend) { deliver(String(prefill.text).trim()); return; }
    setText(prefill.text);
    inputRef.current?.focus();
  }, [prefill]);   // eslint-disable-line react-hooks/exhaustive-deps
  const canSend = !loading && text.trim().length > 0;

  // ★ THE BOX CLEARS ONLY WHEN THE SEND IS ACCEPTED. `onSend` returns false when it declines
  // (already loading, empty after trim) — clearing regardless would lose what someone typed.
  // C404 — `onSend` is ASYNC in the app, so `onSend(msg) === false` compared a Promise and
  // was never true: the C297 guarantee ("the box clears only when the send is accepted") did
  // not hold — a declined send cleared the box. The box clears at once (a send in flight
  // should look sent) and is REFILLED if the promise resolves to false and nothing new
  // has been typed meanwhile.
  const deliver = (msg) => {
    if (!onSend) return;
    const r = onSend(msg);
    if (r === false) return;               // declined synchronously — the text stays
    setText("");
    Promise.resolve(r).then((ok) => { if (ok === false) setText((cur) => cur || msg); }).catch(() => setText((cur) => cur || msg));
  };
  const send = () => {
    if (!canSend) return;
    deliver(text.trim());
  };

  return (
    <>
      {showSuggestions && (
        <div style={{ padding: "0 16px 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => { setText(s); inputRef.current?.focus(); }}
              style={{ fontSize: 11, padding: "5px 10px", borderRadius: 20, background: "var(--sc-border)", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer", textAlign: "left" }}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--sc-border)", display: "flex", gap: 8, flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(); }}
          placeholder="Ask anything about your books..."
          style={{ flex: 1, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 10, padding: "10px 14px", color: "var(--sc-text)", fontSize: 13, outline: "none", fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}
        />
        <button onClick={send} disabled={!canSend} style={{
          width: 40, height: 40, borderRadius: 10,
          background: canSend ? "linear-gradient(135deg,var(--sc-gold),var(--sc-gold))" : "var(--sc-border)",
          border: "none", color: "var(--sc-text)", cursor: canSend ? "pointer" : "not-allowed", fontSize: 16, flexShrink: 0,
        }}>↑</button>
      </div>
    </>
  );
}
