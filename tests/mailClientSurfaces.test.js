import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderViewHtml } from "./helpers/renderView.jsx";
import MailChannelSettings from "../src/components/MailChannelSettings.jsx";
import HeldMailLine from "../src/components/HeldMailLine.jsx";
import { releaseInboundMessage, addAllowedSender, sendMailViaFunction } from "../src/lib/mailClient.js";

// ═════════════════════════════════════════════════════════════════════════════
// O82, C351 — the client half. The Settings block says which of four states it is in; the
// Home line names the sender; releasing a held message creates intake rows only for what
// the receiver would have read; Send Invoice sends from the app only when it can, and says
// which door it used.
// ═════════════════════════════════════════════════════════════════════════════
const strip = (h) => h.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

describe("★ the Settings block — four states, each said (MAIL_DOMAIN is null in tests)", () => {
  it("a failed load says we could not ASK, never that there is no channel", () => {
    const html = strip(renderViewHtml(MailChannelSettings, { mailChannel: { ok: false, channel: null, status: null }, isAdmin: true }));
    expect(html).toContain("couldn't check your documents address");
    expect(html).not.toContain("Set up my documents address");
  });
  it("with no domain the feature is named and no address is shown", () => {
    const html = strip(renderViewHtml(MailChannelSettings, { mailChannel: { ok: true, channel: { inbound_token: "k7f2m9q1zx12", allowed_senders: [] }, status: null }, isAdmin: true }));
    expect(html).toContain("isn't switched on yet");
    expect(html).not.toContain("@in.");
  });
});

describe("★ the Home line — names the sender, and only an owner/admin may decide", () => {
  const held = [{ id: "m1", from_email: "asst@cpa.com", subject: "Sept invoices", attachment_count: 3 }];
  it("renders nothing when nothing is held", () => {
    expect(renderViewHtml(HeldMailLine, { heldInbound: [] })).toBe("");
  });
  it("an admin sees the sender, the count kept, and both buttons", () => {
    const html = strip(renderViewHtml(HeldMailLine, { heldInbound: held, isAdmin: true }));
    expect(html).toContain("asst@cpa.com");
    expect(html).toContain("3 attachments kept, not read");
    expect(html).toContain("Allow this sender");
    expect(html).toContain("Ignore");
  });
  it("a member sees the message and is told who can decide", () => {
    const html = strip(renderViewHtml(HeldMailLine, { heldInbound: held, isAdmin: false, isOwner: false }));
    expect(html).toContain("An owner or admin can allow or ignore it.");
    expect(html).not.toContain("Allow this sender");
  });
});

// A stub client: records writes, answers reads from a table map.
function stubSupabase({ documents = [], updateRows = 1, updateRowsFor = {} } = {}) {
  const writes = [];
  const q = (table) => {
    const chain = {
      _table: table, _op: null, _payload: null,
      select() { return chain; }, eq() { return chain; }, in() { return chain; }, order() { return chain; }, limit() { return chain; },
      update(p) { chain._op = "update"; chain._payload = p; return chain; },
      insert(p) { chain._op = "insert"; chain._payload = p; return chain; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      single() { writes.push({ table, op: chain._op, payload: chain._payload }); return Promise.resolve({ data: { id: `${table}-${writes.length}` }, error: null }); },
      then(res) {
        if (chain._op) { writes.push({ table, op: chain._op, payload: chain._payload }); const n = updateRowsFor[table] ?? updateRows; return res({ data: Array.from({ length: n }, (_, i) => ({ id: i })), error: null }); }
        if (table === "documents") return res({ data: documents, error: null });
        return res({ data: [], error: null });
      },
    };
    return chain;
  };
  return { from: q, writes };
}

describe("★★ releasing a held message creates intake rows only for what the receiver would read", () => {
  it("readable → intake row with source=email and document_id; unreadable → kept, no row; the message is marked accepted", async () => {
    const sb = stubSupabase({ documents: [
      { id: "d-pdf", name: "hcm.pdf", mime_type: "application/pdf", file_size_bytes: 4000 },
      { id: "d-doc", name: "notes.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", file_size_bytes: 400 },
    ] });
    const r = await releaseInboundMessage(sb, { companyId: "c1", allowedSenders: [], message: { id: "m1", from_email: "Asst@CPA.com", subject: "x", attachment_document_ids: ["d-pdf", "d-doc"] } });
    expect(r.ok).toBe(true);
    const intake = sb.writes.filter(w => w.table === "document_intake");
    expect(intake).toHaveLength(1);
    expect(intake[0].payload).toMatchObject({ company_id: "c1", source: "email", status: "received", document_id: "d-pdf", filename: "hcm.pdf" });
    const allow = sb.writes.find(w => w.table === "company_channels");
    expect(allow.payload.allowed_senders).toEqual(["asst@cpa.com"]);
    const msg = sb.writes.find(w => w.table === "inbound_messages");
    expect(msg.payload.status).toBe("accepted");
    expect(msg.payload.intake_ids).toHaveLength(1);
  });
  it("★ an allow that touched zero rows is a failure, and NOTHING ELSE IS WRITTEN — a readable file is not queued from a sender who was not allowed", async () => {
    const sb = stubSupabase({ documents: [{ id: "d1", name: "a.pdf", mime_type: "application/pdf", file_size_bytes: 10 }], updateRowsFor: { company_channels: 0 } });
    const r = await releaseInboundMessage(sb, { companyId: "c1", message: { id: "m1", from_email: "a@b.c", attachment_document_ids: ["d1"] } });
    expect(r.ok).toBe(false);
    expect(sb.writes.filter(w => w.table === "document_intake")).toHaveLength(0);
    expect(sb.writes.filter(w => w.table === "inbound_messages")).toHaveLength(0);
  });
  it("addAllowedSender refuses a non-address", async () => {
    expect((await addAllowedSender(stubSupabase(), { companyId: "c1", email: "nope" })).ok).toBe(false);
  });
});

describe("★ sendMailViaFunction reports the function's verdict, never the click", () => {
  it("a 502 from the function is NOT sent, whatever the body says", async () => {
    const fetchImpl = async () => ({ ok: false, status: 502, json: async () => ({ ok: true, status: "sent" }) });   // a gateway page, or a lie
    const r = await sendMailViaFunction({ companyId: "c1", kind: "invoice", to: "x@y.z", subject: "s", text: "t" }, fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/send-mail → 502/);
  });
  it("a network failure is NOT sent", async () => {
    const r = await sendMailViaFunction({ companyId: "c1", kind: "invoice", to: "x@y.z", subject: "s", text: "t" }, async () => { throw new Error("offline"); });
    expect(r.ok).toBe(false);
  });
});

describe("★ Send Invoice — the door is said, and 'sent' is the function's verdict", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/SendInvoiceView.jsx"), "utf8");
  it("sends from the app only with a domain, a channel and a stored invoice to be about", () => {
    expect(src).toMatch(/const canSendFromApp = !!MAIL_DOMAIN && !!\(mailChannel\?\.channel \|\| mailChannel\?\.status\?\.configured\)/);
    expect(src).toMatch(/if \(canSendFromApp && isDbInvoiceId\(saved\.id\)\) \{[\s\S]{0,300}kind: "invoice"[\s\S]{0,200}related: \{ arInvoiceId: saved\.id \}/);
  });
  it("★ a refused send says NOT sent and that the books are right", () => {
    expect(src).toMatch(/is in your books but was NOT sent/);
  });
  it("the button names the door", () => {
    expect(src).toMatch(/canSendFromApp \? "Send Invoice →" : "Send from my mail app →"/);
  });
});
