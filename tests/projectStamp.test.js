import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ═════════════════════════════════════════════════════════════════════════════
// C477 — THE PROJECT NEVER REACHED THE DATABASE FROM A BOOKING. `post_journal_entry`
// inserts (account_id, debit, credit, memo) per line and no `project`; the manual form's
// picker, a supplier rule's project and a recurring charge's project rode the in-session row
// onto the By Project report and came back as "General" on the next reload. The ONE writer of
// `journal_entry_lines.project` was the AI's retag action. `O95`'s class, on a column that
// exists and that the retag path already proved writable.
// ═════════════════════════════════════════════════════════════════════════════
const app = fs.readFileSync("src/App.jsx", "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
const rpc = fs.readFileSync("supabase/migrations/010_post_journal_entry.sql", "utf8");

describe("C477 · the project is stamped on the lines after the post", () => {
  it("the RPC genuinely does not carry project (the premise)", () => {
    const ins = rpc.slice(rpc.indexOf("insert into public.journal_entry_lines"), rpc.indexOf(")", rpc.indexOf("insert into public.journal_entry_lines")));
    expect(ins).not.toMatch(/project/);
  });
  it("persistJournalEntry stamps a non-General project through the one writer, after the post, and audits a miss", () => {
    const i = app.indexOf("const persistJournalEntry = async");
    const fn = app.slice(i, app.indexOf("const rpcMissing =", i));
    const post = fn.indexOf('supabase.rpc("post_journal_entry"');
    const stamp = fn.indexOf("await stampLineProject(newId, proj)");
    expect(post).toBeGreaterThan(-1); expect(stamp).toBeGreaterThan(post);
    expect(fn).toMatch(/if \(newId && proj && proj !== "General"\) \{\s*\n\s*const pr = await stampLineProject\(newId, proj\);\s*\n\s*if \(!pr\.ok\) logAudit\("entry_project_stamp_failed"/);
  });
  it("there is exactly one writer of journal_entry_lines.project, and it reads the value back", () => {
    const writes = app.match(/from\("journal_entry_lines"\)\.update\(\{ project \}\)/g) || [];
    expect(writes).toHaveLength(1);
    const w = app.slice(app.indexOf("const stampLineProject = async"), app.indexOf("const persistChatRetagProject"));
    expect(w).toMatch(/chk\.every\(r => r\.project === project\)/);
    expect(app).toMatch(/const w = await stampLineProject\(dbIds, project\);\s*\n\s*if \(!w\.ok\) return w;/);
  });
});
