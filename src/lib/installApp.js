// ═════════════════════════════════════════════════════════════════════════════
// C770 — "PUT SHADOW ON YOUR HOME SCREEN". Shadow installs to a phone's home screen (C736's manifest),
// but nothing told anyone — and on an iPhone it is a three-step menu almost nobody knows. A small card
// on Home, on a phone only, until it is installed or dismissed. Android Chrome offers a real one-tap
// install (the `beforeinstallprompt` event); iPhone gets the steps. Pure decisions here; the card is
// components/AddToHomeScreen.jsx.
// ═════════════════════════════════════════════════════════════════════════════
export const A2HS_DISMISS_KEY = "sc_a2hs_dismissed";

// Which phone this is, from its user agent (and iPadOS, which reports itself as a Mac with touch).
export function phonePlatform({ userAgent = "", maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent || "");
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

// Show the card? Only on a touch phone, not already opened from the home screen, not dismissed.
export function shouldOfferInstall({ isPhone = false, standalone = false, dismissed = false, platform = "other" } = {}) {
  return !!isPhone && !standalone && !dismissed && (platform === "ios" || platform === "android");
}

export const A2HS_COPY = {
  title: "Put Shadow on your home screen",
  sub: "Open it like an app — one tap to snap a receipt.",
  show: "Show me how",
  install: "Add to home screen",
  notNow: "Not now",
  ios: [
    { icon: "share", text: "Tap the Share button in Safari (the square with an arrow, at the bottom of the screen)." },
    { icon: "plusSquare", text: "Scroll down and tap “Add to Home Screen”." },
    { icon: "check", text: "Tap “Add”. Shadow is now on your home screen." },
  ],
  android: [
    { icon: "moreVertical", text: "Tap the ⋮ menu at the top right of Chrome." },
    { icon: "plusSquare", text: "Tap “Add to Home screen” (or “Install app”)." },
    { icon: "check", text: "Tap “Add”. Shadow is now on your home screen." },
  ],
};
