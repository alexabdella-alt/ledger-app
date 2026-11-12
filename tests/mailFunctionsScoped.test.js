import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C635 — review finding S9 (security). The email functions are NOT deployed; this is their code.
const send = readFileSync("supabase/functions/send-mail/index.ts", "utf8");
const recv = readFileSync("supabase/functions/receive-mail/index.ts", "utf8");

describe("send-mail", () => {
  it("★ every related id is checked against the sender's company before the message is recorded", () => {
    expect(send).toMatch(/for \(const \[table, id, what\] of \[\["document_intake", related\.intakeId, "document"\], \["anomalies", related\.anomalyId, "alert"\]\] as const\)/);
    expect(send).toMatch(/if \(!rel \|\| rel\.company_id !== companyId\) return json\(\{ error: `That \$\{what\} is not in this company\.` \}, 403\);/);
    expect(send.indexOf("rel.company_id !== companyId")).toBeLessThan(send.indexOf('from("outbound_messages").insert('));
  });
});

describe("receive-mail", () => {
  it("★ a reply writes only to an intake row in the same company", () => {
    expect(recv).toMatch(/\.select\("detail"\)\.eq\("id", out\.related_intake_id\)\.eq\("company_id", companyId\)\.maybeSingle\(\)/);
    expect(recv).toMatch(/\.eq\("id", out\.related_intake_id\)\.eq\("company_id", companyId\)\.select\("id"\)/);
  });
  it("★ attachments are bounded: a few from an unknown sender, none over the file ceiling", () => {
    expect(recv).toMatch(/const MAX_HELD_ATTACHMENTS = 5;/);
    expect(recv).toMatch(/const keepAtMost = plan\.status === INBOUND_STATUS\.UNKNOWN_SENDER \? MAX_HELD_ATTACHMENTS : MAX_ACCEPTED_ATTACHMENTS;/);
    expect(recv).toMatch(/if \(i >= keepAtMost\) \{/);
    expect(recv).toMatch(/if \(bytes\.length > MAX_ATTACHMENT_BYTES\) \{/);
    expect(recv.indexOf("if (bytes.length > MAX_ATTACHMENT_BYTES)")).toBeLessThan(recv.indexOf('storage.from("documents").upload(path'));
  });
});
