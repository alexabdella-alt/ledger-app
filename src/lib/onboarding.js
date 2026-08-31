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
// ★★ HAS A PERSON EVER SAVED THIS ROW? `bank_accounts` carries a `set_updated_at` trigger,
// so `updated_at` moves past `created_at` on the first update and stays there. The seeded row
// is INSERTed once and never touched, so the two timestamps are identical — meaning the fact
// we want is already recorded and needed no new column.
//
// ★ TOLERANCE, not equality: both timestamps come from the same `now()` on insert, but a
// second's slack costs nothing and protects against clock precision. And an UNPARSEABLE or
// missing pair returns FALSE — *we do not know that anyone edited it*, which keeps the old
// heuristic in charge rather than quietly declaring every account real.
export function bankEverEdited(b = {}) {
  const created = Date.parse(b.created_at || "");
  const updated = Date.parse(b.updated_at || "");
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;
  return updated - created > 1000;
}

export function isPlaceholderBank(b = {}) {
  // ★★ THE RESIDUAL THIS CLOSES: a REAL account genuinely called "Primary Checking", with no
  // bank name, no last four and no balance yet, was indistinguishable from the row we seed at
  // company setup — so the onboarding step "add your bank account" could never be ticked off,
  // and nothing on screen explained why. Editing it was the user's own assertion that it is
  // theirs; the code simply had no way to hear it.
  if (bankEverEdited(b)) return false;
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
