# CODE_REVIEW.md — Structured code review

A running ledger of findings from a structured, multi-pass code review of the Shadow CFO
codebase. Each **pass** is a focused review of one concern (e.g. security, a subsystem, a
cross-cutting property); each pass is one section below. **Reviews are findings-only — no code
is changed during a review pass.** Fixes happen later, as separate tracked work.

## How to read this

Each finding has:
- **ID** — `CR-N`, stable and never reused.
- **Severity** — see legend.
- **Location** — `file:line` (or a region / "cross-cutting").
- **Explanation** — one paragraph: what it is and why it matters.
- **Recommended fix** — the suggested direction (not applied here).

Each pass section ends with a **Verdict** paragraph — the reviewer's overall read of that area.

### Severity legend

| | Severity | Meaning |
|---|---|---|
| 🔴 | **fix-before-launch** | Correctness/security/data-loss risk; must be resolved before real users. |
| 🟠 | **should-fix** | Real problem worth fixing soon; not a launch blocker on its own. |
| 🟡 | **improvement** | Code health / maintainability / minor correctness; fix opportunistically. |
| 🔵 | **suggestion** | Optional polish or a considered idea; take it or leave it. |

### Conventions

- Findings are grouped under the pass that surfaced them; a later pass may reference an earlier
  `CR-N` rather than re-filing it.
- Severity reflects the finding **as it stands in the code**, independent of how easy the fix is.
- Where a finding is already tracked elsewhere (ROADMAP `O#`, `VERIFICATION.md`), the entry links it.

---

## Index of passes

_(none yet — the first pass will be appended below)_

<!-- Each pass appended below as:  ## Pass N — <focus>  (date) ... findings ... Verdict -->
