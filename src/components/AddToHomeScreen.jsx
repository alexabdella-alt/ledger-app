import React from "react";
import Icon from "./Icon";
import { A2HS_COPY, A2HS_DISMISS_KEY, phonePlatform, shouldOfferInstall } from "../lib/installApp";

// C770 — Android Chrome fires `beforeinstallprompt` once, early; keep it so the card's button can use it.
let deferredPrompt = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });
}

function readEnv() {
  if (typeof window === "undefined") return null;
  const mm = (q) => { try { return window.matchMedia(q).matches; } catch { return false; } };
  let dismissed = false;
  try { dismissed = window.localStorage.getItem(A2HS_DISMISS_KEY) === "1"; } catch { /* storage blocked */ }
  return {
    isPhone: mm("(pointer: coarse)") && mm("(max-width: 760px)"),
    standalone: mm("(display-mode: standalone)") || window.navigator.standalone === true,
    dismissed,
    platform: phonePlatform({ userAgent: window.navigator.userAgent, maxTouchPoints: window.navigator.maxTouchPoints || 0 }),
  };
}

export default function AddToHomeScreen() {
  const [env, setEnv] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { setEnv(readEnv()); }, []);
  if (!env || !shouldOfferInstall(env)) return null;
  const dismiss = () => { try { window.localStorage.setItem(A2HS_DISMISS_KEY, "1"); } catch { /* storage blocked */ } setEnv({ ...env, dismissed: true }); };
  const oneTap = env.platform === "android" && deferredPrompt;
  const install = async () => {
    if (!deferredPrompt) { setOpen(true); return; }
    try { deferredPrompt.prompt(); const r = await deferredPrompt.userChoice; deferredPrompt = null; if (r && r.outcome === "accepted") dismiss(); } catch { setOpen(true); }
  };
  const steps = env.platform === "ios" ? A2HS_COPY.ios : A2HS_COPY.android;
  return (
    <section data-add-to-home style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: "14px 16px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: "var(--sc-gold-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="phoneDevice" size={19} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sc-text)" }}>{A2HS_COPY.title}</div>
          <div style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 2 }}>{A2HS_COPY.sub}</div>
        </div>
      </div>
      {open && (
        <ol data-a2hs-steps style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
          {steps.map((st, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", borderTop: i ? "1px solid var(--sc-surface-2)" : "none", fontSize: 13, color: "var(--sc-text)", lineHeight: 1.45 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid var(--sc-border-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--sc-text-2)" }}><Icon name={st.icon} size={14} /></span>
              <span>{st.text}</span>
            </li>
          ))}
        </ol>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {oneTap
          ? <button data-a2hs-install onClick={install} style={{ padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", background: "var(--sc-gold)", color: "var(--sc-on-accent)", cursor: "pointer" }}>{A2HS_COPY.install}</button>
          : !open && <button data-a2hs-show onClick={() => setOpen(true)} style={{ padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", background: "var(--sc-gold)", color: "var(--sc-on-accent)", cursor: "pointer" }}>{A2HS_COPY.show}</button>}
        <button data-a2hs-dismiss onClick={dismiss} style={{ padding: "8px 12px", borderRadius: 9, fontSize: 13, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>{A2HS_COPY.notNow}</button>
      </div>
    </section>
  );
}
