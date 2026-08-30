# WHERE THE 8,629 LINES ACTUALLY ARE

**Measured 2026-08-30. Not a plan — a map, so the extraction session starts with data instead
of a guess.** `O89` says *"the main app file is 7,000 lines"*; it is **8,629**, and roughly 800
of those arrived today.

> **★ THE FIRST VERSION OF THIS MEASUREMENT WAS WRONG AND I NEARLY REPORTED IT.** It attributed
> **732 lines to `glBreakdown`, which is five lines long** — everything after it (the context
> object and the JSX) fell into it because nothing following matches a declaration. **A census
> that names the wrong culprit is worse than no census: it sends the next session to the wrong
> file.** Bounded now at `const erpCtx`, where the component's logic ends.

## THE SHAPE

| | lines |
|---|---|
| component logic (237 declarations) | **7,907** |
| the context object + the JSX render | **722** |
| median declaration | **14** |

**★★ THE DISTRIBUTION IS THE FINDING, AND IT ARGUES AGAINST A GENERAL REFACTOR.** The median
declaration is **14 lines**. 225 of the 237 are small and unremarkable. **The file is not
uniformly bloated — it is a normal component with a dozen very large functions in it**, and
"split App.jsx" as a project would spend most of its risk on the 225 that are fine.

| lines | declaration | at |
|---|---|---|
| **920** | `processUploadItem` | `:4485` |
| 324 | `handleChatSend` | `:7536` |
| 272 | `handleBankFile` | `:5842` |
| 195 | `persistJournalEntry` | `:1365` |
| 194 | `handleContractFile` | `:6523` |
| 193 | `loadAllData` | `:1102` |
| 178 | `markBillPaid` | `:7167` |
| 152 | `storeDocument` | `:586` |
| 147 | `bookBankTransactions` | `:6376` |
| 143 | `runStatementPipeline` | `:6233` |
| 122 | `runMatchingEngine` | `:6774` |
| 111 | `postOpeningBalances` | `:1720` |

**Twelve declarations are 37% of the logic. One is 12% by itself.**

## WHAT THIS DOES NOT SAY

- **It does not say these should be extracted.** Several are large *because they orchestrate*,
  and this codebase has paid twice for splitting one contract into two halves that then drifted
  (`·3a`'s inert gate; the reason `O116`'s payroll pipeline was MOVED and not copied today).
  **A 900-line function with one caller is a different problem from a 900-line function with
  six**, and this map does not distinguish them.
- **It does not measure risk.** `persistJournalEntry` is 195 lines and is the single canonical
  write path for the ledger; `handleChatSend` is 324 and drives a chat box. Length is not
  danger.
- **It does not account for tests.** Anything moved to `src/lib/` becomes purely testable,
  which is the actual prize — not the line count.

## THE HONEST NOTE ABOUT TODAY

**This session made `O89` worse on purpose, once, and by accident the rest of the time.**
`O116` MOVED 148 lines of payroll pipeline *into* this file so the Home queue could reach it —
a deliberate trade of file size for a single implementation, and the right call. The other
~650 lines are the accumulation of eleven features and fixes, each individually small.

**★ RECORDING IT BECAUSE A NUMBER THAT ONLY EVER GETS QUOTED FROM AN OLD NOTE STOPS BEING A
MEASUREMENT.** `O89` had said "7,000" for long enough that it read as a fact about the file
rather than a reading taken once.
