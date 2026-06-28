// ─────────────────────────────────────────────────────────────────────────────
// Home onboarding checklist — pure visibility + step-completion logic (Item 54).
//
// The bug this guards against: on refresh the checklist briefly flashed its
// "0 of 4 done" welcome card, because companySettings/bankAccounts/invoices load
// async and start empty — so every step read as "not done" for a frame even for a
// fully-onboarded company. The fix: distinguish "not loaded yet" from "not done".
// The checklist is visible ONLY once the company's data has loaded AND onboarding
// is genuinely incomplete. Empties are trusted only after the load completes.
// ─────────────────────────────────────────────────────────────────────────────

// A bank only counts once the user added a REAL one — not the "Primary Checking"
// placeholder seeded at company setup (real DB id, but no institution/last4).
export function isPlaceholderBank(b = {}) {
  const nm = (b.name || "").trim().toLowerCase();
  const noDetails = !(b.institution || "").trim() && !(b.last4 || "").trim();
  return nm === "primary checking" && noDetails;
}

// Per-step completion + the rolled-up "all required done" signal.
export function onboardingSteps({ companySettings = {}, bankAccounts = [], openingBalances = [], invoices = [], onboardingUploadDone = false } = {}) {
  const obHasBiz = !!(companySettings.name && companySettings.businessType);
  const obHasBank = (bankAccounts || []).some(
    (b) => b.id && b.id !== "default" && (b.name || "").trim() && !isPlaceholderBank(b)
  );
  // Durable across reloads: opening balances post journal entries (source "opening_balance").
  const obHasOpening = (openingBalances || []).length > 0 || (invoices || []).some((i) => i.source === "opening_balance");
  const obHasUpload = !!onboardingUploadDone;
  const obAllDone = obHasBiz && obHasBank && obHasOpening && obHasUpload;
  const requiredDone = [obHasBiz, obHasBank, obHasOpening, obHasUpload].filter(Boolean).length;
  return { obHasBiz, obHasBank, obHasOpening, obHasUpload, obAllDone, requiredDone };
}

// The flash fix, distilled: show the checklist ONLY once data has loaded and
// onboarding is genuinely incomplete. Before the load (companyDataLoaded=false) the
// empties are "unknown", not "incomplete", so we render nothing.
export function onboardingChecklistVisible({ companyDataLoaded = false, onboardingComplete = false } = {}) {
  return !!companyDataLoaded && !onboardingComplete;
}
