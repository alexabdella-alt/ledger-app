// ═════════════════════════════════════════════════════════════════════════════
// C590 — WHAT THE STARTING-BALANCES GRID SHOWS, AND WHAT "UPDATE" SENDS.
//
// Three defects from the whole-code review, all on the one entry every report is built on:
//
//  1. THE FIRST KEYSTROKE BLANKED EVERY OTHER FIGURE. The grid showed its pre-filled values
//     only while NOTHING had been typed (`Object.keys(typed).length > 0 ? typed : initial`),
//     so correcting one number replaced the whole grid with that one number — and "Update"
//     posted only it, retiring the entry that held the rest. Fixing a typo in the loan
//     balance deleted the opening cash.
//  2. EDITING REPLACED OPENING CASH WITH THE BANK'S LATEST BALANCE. A bank-linked account was
//     pre-filled from `bank_accounts.current_balance` — which, once a statement has been
//     read, is that statement's ENDING balance — in preference to the figure actually saved.
//     Opening the screen and pressing Update moved day-one cash to the end of the month.
//  3. THE SAVE-TIME FALLBACK DID THE SAME behind a cleared field (`bankFallbackFor`).
//
// THE RULE: what was SAVED wins over anything inferred, what was TYPED wins over what was
// saved, and the bank's balance is offered only before any starting balance exists.
// Pure, so the grid cannot drift from what is posted: the screen renders `values` and posts
// `openingGridToPost(values)`.
// ═════════════════════════════════════════════════════════════════════════════

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

function bankBalanceByCode(bankAccounts = []) {
  const out = {};
  for (const b of bankAccounts || []) {
    if (b && b.gl_code) out[b.gl_code] = (out[b.gl_code] || 0) + (Number(b.current_balance) || 0);
  }
  return out;
}

// `saved`  — the loaded opening_balances rows ({ account_code, balance })
// `typed`  — what the person has typed this visit ({ code: string })
// Returns `values` (code → what the field shows) and `fromBank` (codes whose shown value is
// the bank's balance, offered rather than saved — the only ones that may say "from bank").
export function openingGridValues({ accounts = [], saved = [], bankAccounts = [], typed = {} } = {}) {
  const savedByCode = {};
  for (const r of saved || []) if (r && r.account_code != null) savedByCode[String(r.account_code)] = r.balance;
  const hasSaved = (saved || []).length > 0;
  const bank = bankBalanceByCode(bankAccounts);
  const values = {};
  const fromBank = new Set();
  for (const a of accounts || []) {
    const code = String(a.code);
    if (Object.prototype.hasOwnProperty.call(typed || {}, code)) { values[code] = typed[code]; continue; }
    if (savedByCode[code] != null) { values[code] = savedByCode[code]; continue; }
    if (!hasSaved && bank[code]) { values[code] = bank[code]; fromBank.add(code); continue; }
    values[code] = "";
  }
  return { values, fromBank };
}

// What "Save" sends: every non-zero figure on the grid, as numbers.
export function openingGridToPost(values = {}, accounts = []) {
  const grid = {};
  for (const a of accounts || []) { const v = num(values[String(a.code)]); if (v) grid[String(a.code)] = v; }
  return grid;
}

// The bank's balance stands in for a cash account the grid left empty — ONLY on the very
// first save. Once a starting position exists, an empty field means zero: filling it from the
// bank would write this month's balance into day one.
export function bankFallbackFor(grid = {}, bankAccounts = [], { hasSavedOpening = false } = {}) {
  const merged = { ...(grid || {}) };
  if (hasSavedOpening) return merged;
  for (const [code, val] of Object.entries(bankBalanceByCode(bankAccounts))) {
    if (merged[code] == null || merged[code] === "" || Number(merged[code]) === 0) merged[code] = val;
  }
  return merged;
}
