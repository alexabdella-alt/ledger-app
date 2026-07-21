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

// A bank only counts once the user has ADOPTED a real account — not the untouched
// "Primary Checking" placeholder seeded at company setup (real DB id, default name,
// no institution/last4, zero balance).
//
// The bug this closes (O83): the seeded account keeps its default name, and a user
// who sets it up WITHOUT typing an institution/last4 — e.g. just enters their
// balance in Settings → Bank Accounts — was still classified as the empty
// placeholder, so "Add your bank account" never ticked. Adoption is broader than
// institution/last4: a RENAME, an institution, a last4, OR a balance the user
// entered all mean it's a real account. The pristine seed = default name AND no
// details AND no balance; any one of those changing makes it count.
//
// (A genuinely-new account added via "+ Add Bank Account" already counts here — it
//  carries a non-default name. The residual field-identical case — a real account a
//  user names "Primary Checking" with $0 and no details — is indistinguishable from
//  the seed by fields alone; it resolves once statement transactions carry a
//  bank_account_id linkage. See the O83 Issue-3 investigation.)
export function isPlaceholderBank(b = {}) {
  const nm = (b.name || "").trim().toLowerCase();
  const noDetails = !(b.institution || "").trim() && !(b.last4 || "").trim();
  const noBalance = !Number(b.current_balance);   // 0 / blank / NaN — no balance entered
  return nm === "primary checking" && noDetails && noBalance;
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
