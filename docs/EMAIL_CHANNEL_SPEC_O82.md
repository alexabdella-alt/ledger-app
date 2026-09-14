# O82 — EMAIL FIRST: THE BOOKKEEPER YOU FORWARD THINGS TO

**Design spec. Drafted 2026-09-14 at the operator's instruction (*"email first, write the spec"*).
APPROVED the same day with four decisions: provider **Resend** · Phase A budget (the drain charges
whoever opens the app) **accepted** · digest **opt-in** · Phase C (replies that act) **stays gated
on `O81`**. The domain is still to be named (§10.1); everything reads it from `MAIL_DOMAIN`.
BUILD STARTED: migrations `088`–`090` written (NOT applied), `_shared/mailChannel.js`,
`receive-mail` and `send-mail` edge functions written (NOT deployed).**

Same species as `docs/INVOICE_PAYMENT_SPEC_O114.md` and `docs/ACCEPT_AND_QUEUE_SPEC_O97.md`: a
design session written before code, with acceptance criteria pre-registered so the result cannot be
rationalised either way. It covers the two things the operator asked for on 2026-09-14 — *forward
invoices to an inbox* and *send an invoice from the app* — and shows why they are one integration.

---

## 0. WHAT EXISTS, WHAT DOES NOT, STATED FROM THE CODE

**Exists and is reused unchanged:**

| Thing | Where | Why it matters here |
|---|---|---|
| Durable intake ledger, with `source` already allowing `'email'` / `'inbox'` | `supabase/migrations/047`, `document_intake.source` | The receiver writes the same row every drop writes. **No second population.** |
| Durable-first byte store + content-hash dedupe | `storeDocument`, C193 / C300 | A forwarded PDF is stored the way a dropped one is; the same bytes twice link to one row. |
| The drain — resumes any intake row with durable bytes | `src/lib/intakeDrain.js`, `runDrain` (`App.jsx:4302`), polled every 60 s on company load | **This is how an emailed document gets processed without a second pipeline** (§3). |
| The upload pipeline (classify → extract → code → book) | `processUploadItem`, inside `ERP` | The only implementation, and it lives in a React component. That fact drives §3's phasing. |
| Per-user AI budget, hourly and daily, refusals uncharged | `ai-proxy`, migrations `074`/`086`/`087` | Applies to whoever's session runs the drain — see §3.3. |
| Completeness net (intake rows ↔ recorded entries) | `computeControlTotals`, `docs_recorded` (C311) | An email-received row is chased like any other. |
| Send Invoice (books A/R, opens the person's OWN mail client via `mailto:`, or prints) | `SendInvoiceView.jsx:111`, `:164` | The only "outbound" today, and it is not outbound from the app. |
| The in-app assistant (chat, spending questions, reports, sandboxed actions) | `runAIBrain`, `AI_ALLOWED_ACTIONS` | The brain an email reply would reach. |

**Does not exist:**

- Nothing receives email. There is no inbound address, no webhook, no edge function other than `ai-proxy`.
- Nothing sends email from the app. No provider, no from-address, no template, no delivery record.
  Team invites go out through Supabase Auth's own mailer, which is not usable for arbitrary mail.
- No durable record of a *question asked of the owner*. Clarification cards are React state (`O121`);
  the only durable "question" is a HELD intake row's `detail`. A question sent by email must survive
  a reload or its answer has nothing to land on.
- No notion of *who may send documents into this company* other than "is a member of it".

---

## 1. THE TWO ASKS ARE ONE INTEGRATION

Sending an invoice **from** the app and sending *"what was this $400 for?"* **from** the app need the
same three things: a transactional email provider, a verified sending domain, and a durable record of
each message so a reply can be matched to what it answers. Receiving a forwarded invoice needs the same
domain pointed inbound and a webhook that turns a message into intake rows. **One domain, one
provider, one `messages` model, two directions.** Building either ask alone would build 70% of the
other and then re-build it.

Everything below is scoped to **email**. Slack and SMS are the thesis's later channels; nothing here
precludes them and nothing here builds toward them — a message record with a `channel` column is the
whole concession.

---

## 2. INBOUND — A FORWARDED EMAIL BECOMES INTAKE ROWS

### 2.1 The address

Each company gets one inbound address: **`docs-<token>@in.<domain>`**, where `<token>` is 10 random
characters minted at company creation (or on first use) and stored on the company's channel record
(§5). It is shown once in Settings with *"Forward anything here"*, and can be rotated.

Why a token, not a slug: a guessable address (`redriver@in…`) lets a stranger drop documents into a
company's books. The token is the secret; §2.2 is the check behind it.

### 2.2 Who may send — the sender rule, and its failure direction

An inbound message is **accepted** when the `From:` address, normalised, is one of:

1. a member of the company (`company_users` ⨝ `auth.users.email`), or
2. an address the company has explicitly allowed (`channel.allowed_senders` — the bookkeeper's
   assistant, the owner's second address).

Anything else is **held, not dropped, and not processed**: stored as an `inbound_messages` row with
`status = 'unknown_sender'`, attachments stored to Storage but **no `document_intake` row and no AI
call**, and a Home line for the owner: *"An email from `x@y` arrived at your documents address and
we didn't recognise the sender — allow them, or ignore it."* One click allows the sender and releases
the message into §2.3.

**The failure direction is chosen:** a legitimate assistant forwarding from an unlisted address costs
one click; a stranger's attachment costs nothing, because it never reaches the pipeline and never
spends budget. `From:` is spoofable, which is why the token address exists as well — both must match.
That is not a wall against a determined attacker; it is a wall against the ordinary one, and §2.6
caps what the determined one can cost.

### 2.3 What a message becomes

For an accepted message, the receiver — an edge function with the service role, because there is no
user session — does, in this order, and **durably before anything else**:

1. **Store the raw message** (`.eml`, or the provider's JSON) as ONE document, `document_type = 'other'`,
   tagged `email-source`. This is the audit record of what arrived; it is never processed.
2. **One `document_intake` row per attachment**, `source = 'email'`, `status = 'received'`,
   `document_id` set (bytes stored first — the `O97` ordering, which the drain requires), `content_hash`
   set (so C193/C195(7) dedupe applies), `filename` = the attachment's name, and `detail` carrying the
   sender and subject. **This row is the same row a drop creates**, so the completeness net, the
   Documents tab, the drain and the accuracy checks see it with no new code.
3. **Inline images** (a receipt pasted into the body) count as attachments.
4. **A message with no attachment** is not a document; it is a sentence for the assistant — §4.4.
5. **An `inbound_messages` row** linking the raw document, the intake rows it produced, and the
   provider's message id (idempotency: the provider WILL redeliver; the same message id is a no-op).

Then the acknowledgement (§4.2): *"Got it — 3 documents saved. They'll be in your books shortly."*
**"Saved" is the claim, because saved is what is true at that moment.** Not "booked".

### 2.4 Dedupe is the existing dedupe

The same invoice forwarded twice hashes to the same bytes and links to the existing document
(C193); the second intake row auto-resolves as already recorded (C195(7), revived `c2dcbbc`). A
forwarded copy of an invoice that was ALSO dropped on Home is the same case. Nothing new to build,
and §7 pins that it still holds through the email door.

### 2.5 Completeness gains a second control total

`O60` records the reason an inbox is valuable beyond convenience: **the mail server counts what
arrived, independently of the app.** `inbound_messages.attachment_count` (from the provider's
payload) is the external figure; the number of `document_intake` rows the message produced is ours.
The completeness check gains one line: *"N attachments arrived by email this month; N intake rows
exist for them."* A mismatch is the first thing this feature can prove about itself.

### 2.6 Abuse and cost

- Per company: **50 inbound messages / hour, 200 / day** at the receiver (a counter on the channel
  record). Beyond that the message is stored and held with `status = 'rate_limited'`, never dropped.
- Per attachment: **15 MB**, and only the media types the pipeline can read (PDF, images, CSV/XLSX);
  anything else is stored as `other` and not processed — *"we kept it but can't read it."*
- **Nothing in an email body is an instruction to the system.** §4.5.

---

## 3. PROCESSING — THE DRAIN DOES IT, AND THAT IS A LIMITATION SAID OUT LOUD

### 3.1 Phase A: no second pipeline

The pipeline lives inside `ERP` (`processUploadItem`) and is not callable from a server. **Rebuilding
it in an edge function would be a second implementation of the contract that has already shipped one
inert gate, one inverted control total and one dedupe that never fired** — the `·3a` shape every
recorded incident in this repo comes back to. So Phase A does not process on receipt. It stores, it
acknowledges, and **the next time anyone opens the company — owner or CPA — the existing drain picks
the rows up** (they carry `document_id`, so `planDrain` sees them as drainable; the 5-minute spacing
floor means a just-received row waits one tick).

**What that costs, stated plainly:** an emailed invoice is *saved* within seconds and *booked* when
someone next opens the app. For a client whose CPA opens the books weekly, the lag is up to a week.
The acknowledgement copy says exactly that (§4.2), and does not say "booked".

### 3.2 Phase B: a headless worker, gated on `O89`

The thesis's *"never open the app"* needs booking to happen with no tab open. That requires the
pipeline extracted from the component into a module a Deno edge function can import — which is
`O89`'s map (`docs/O89_APP_JSX_MAP.md`), already three slices in (`uploadedInvoice.js`,
`llmMatchFilter.js`, `contractEntries.js`). **Phase B is not started until the pipeline's decision
logic is out of `App.jsx`; a worker that copies it is worse than no worker.** When it lands, the
worker is a scheduled function that runs `runIntakeDrain` with the service role for every company
with drainable rows — the same planner, the same picks, no new rules.

### 3.3 Whose budget

The drain runs as the signed-in user, so **the AI budget for emailed documents is charged to whoever
opens the app** — on a CPA-led company, the CPA. That is acceptable in Phase A (300/hour is 100
documents, per `087`) and it is a decision, not an accident: the alternative, a per-company service
budget, is Phase B's problem and needs its own limit values.

---

## 4. OUTBOUND — THE APP SENDS, AND KEEPS A RECORD OF EVERYTHING IT SENT

### 4.1 Provider and identity

- **Provider:** any transactional service with inbound parsing and webhooks (Resend, Postmark, SES).
  The operator picks; the code depends on one thin adapter (`src/lib/mail/provider.js` on the client
  side is NOT where sending happens — sending is an edge function, `send-mail`, so the API key never
  reaches the browser, exactly as `ai-proxy` holds the Anthropic key).
- **From:** `<company name> via Shadow <bookkeeper@<domain>>`, with `Reply-To` set to the company's
  inbound address so a reply lands in §2 with the message's reply token.
- **Every send is a row** in `outbound_messages` before the provider is called, with `status`
  moving `queued → sent → delivered | bounced` from the provider's webhook. **A message we cannot
  prove was sent is reported as not sent** — the C194 rule, applied to mail.

### 4.2 Kinds of message, and the copy rule for each

Every sentence is derived from the record it describes (§9 doctrine); none is composed alongside the
action.

| Kind | Trigger | Copy reads | Never says |
|---|---|---|---|
| `receipt` | an accepted inbound message | the count of intake rows created | "booked" |
| `question` | a HELD intake row or an anomaly a human must answer | the row's `detail` / the anomaly's own sentence, plus the plain-language options | any accounting word (`containsOwnerJargon` runs on the body) |
| `invoice` | Send Invoice, once the A/R entry is posted | the posted entry's number, total, due date; PDF attached | anything not on the posted entry |
| `report` | an assistant request ("send me my P&L") | the same figures the Reports tab renders, with the C343 attestation line | figures for an unsigned month without the line saying so |
| `digest` | weekly, opt-in | what arrived, what booked, what is waiting | "all clear" unless the trust panel says it |

### 4.3 Questions by email, and the answer landing

A `question` is sent only for something that is **durable**: a HELD intake row (`O135`'s shape) or an
open anomaly. Clarification cards in React state are not eligible until `O121` makes them durable —
sending a question whose subject vanishes on reload is a question whose answer has nowhere to go.

The reply arrives at the inbound address (§2) carrying the reply token in the subject or headers.
The receiver matches it to the `outbound_messages` row, extracts the reply text (above the quoted
original), and records it on the message. **What happens next depends on the kind, and the safe
default is narrow:** for a HELD row, the reply text is stored as the owner's answer and the row stays
HELD for the CPA — the answer is *evidence*, and a person applies it. Automatic application (the
reply "linen service" re-coding the entry) is **Phase C**, after the `O81` battery, because it is an
email body driving a booking.

### 4.4 A message with no attachment is a sentence for the assistant

*"how much did I spend on Sysco last month?"* to the inbound address reaches `runAIBrain` with the
company's context and the sender's identity. **Read-only in Phase A**: the reply is the assistant's
answer, and the action loop's mutating actions (`recode`, `void_invoice`, `delete_invoice`,
`reverse_entry`, `add_rule` …) are **refused for email-originated turns**, logged as
`ai_action_refused` with reason `channel_email`. Only `render_summary`, `export_csv` and the report
kinds are allowed. This is a code-level gate in the action loop keyed on the turn's channel, not a
prompt instruction.

### 4.5 An email body is untrusted data, and the gate is structural

Forwarded invoices come from vendors; replies come from whoever holds the owner's mailbox; a
`From:` can be forged past §2.2's check. So **no text that arrived by email is ever concatenated into
a system prompt**: attachments go through the same untrusted slots the drop zone uses (the
`ai-proxy` profiles already separate server-owned system text from client-supplied slots), the body
of a question-reply is stored as data, and a chat-shaped message is passed as the user turn with the
channel flagged. `O81`'s battery is extended with three email cases (§7.9) before Phase C opens any
mutating action to a reply.

---

## 5. DATA MODEL — three tables, one column, reserved numbers

Migrations **`088`–`090` are RESERVED for this spec** (next free after `087`; confirm with
`ls supabase/migrations/` before minting — the `051` lesson). None is written.

**`088_company_channels`** — one row per company:
`company_id` · `inbound_token text unique` · `allowed_senders text[]` · `from_name` ·
`inbound_hour_count` / `inbound_day_count` + window stamps · `digest_enabled bool default false` ·
RLS: the four `is_company_member` policies, **plus `inbound_token` readable only by admin/owner**
(a viewer must not be able to read the secret).

**`089_inbound_messages`** — one row per message received:
`company_id` · `provider_message_id text unique` · `from_email` · `subject` · `received_at` ·
`raw_document_id` (FK `documents`) · `attachment_count int` · `intake_ids uuid[]` ·
`status` in (`accepted`, `unknown_sender`, `rate_limited`, `no_attachments`, `reply`) ·
`reply_to_outbound_id` (FK, nullable) · `reply_text` · RLS as above.

**`090_outbound_messages`** — one row per message sent:
`company_id` · `kind` in (`receipt`, `question`, `invoice`, `report`, `digest`) · `to_email` ·
`subject` · `body_text` · `reply_token text unique` · `related_intake_id` / `related_anomaly_id` /
`related_ar_invoice_id` (nullable FKs — exactly one set, CHECK) · `status` in
(`queued`, `sent`, `delivered`, `bounced`, `failed`) · `provider_message_id` · `sent_at` ·
`answered_at` · RLS as above, **no UPDATE policy for members** — status moves only through the
service-role webhook, so a row cannot be marked delivered by hand.

**`document_intake.source`** already accepts `'email'`; no change.

Every write in the receiver and the sender is a checked write (`C249`'s rule holds server-side too:
the edge functions assert rows-affected).

---

## 6. WHAT THE OWNER SEES IN THE APP

- **Settings → "Your documents address"**: the token address, a copy button, the allowed-senders
  list, and *"Forward anything here — invoices, receipts, statements. We'll save it the moment it
  arrives and book it the next time your books are opened."* (Phase A copy; Phase B drops the second
  clause.)
- **Documents tab**: cards from email carry a *"by email"* chip and the sender; the raw `.eml` is
  filterable out by default (type `other`, tag `email-source`).
- **Home**: the trust panel's Documents line counts emailed rows exactly as dropped ones; an
  `unknown_sender` message renders one line with *Allow* / *Ignore*.
- **Send Invoice**: the *"Send"* button sends from the app when a channel is configured, and falls
  back to today's `mailto:` when it is not — the fallback is SAID on the button, not silent.
- **Reports**: *"Email me this"* on any report, producing a `report` message with the attestation line.

Nothing on any of these surfaces uses a word `containsOwnerJargon` rejects; `clientSurfaces` covers
the new Settings block the day it exists.

---

## 7. ACCEPTANCE CRITERIA — PRE-REGISTERED, BINARY, WITH THE WRONG-REASON PASS NAMED

Each is written before the build. A criterion that passes for the wrong reason is a fail.

1. **Same bytes, two doors, one document.** Drop `hcm-0805.pdf` on Home; forward it by email. One
   `documents` row, two intake rows, the second auto-resolved as already recorded. *Wrong-reason
   pass:* the email row never reached the drain and so never "conflicted" — check the intake row's
   status is `recorded`, not `received`.
2. **Order-independent.** Forward first, drop second — identical end state to (1).
3. **The sender wall holds, watched to refuse.** A message from an unlisted address produces an
   `inbound_messages` row with `unknown_sender`, ZERO intake rows, ZERO AI calls (assert on
   `rate_limit_events` during the window, not after — `086` prunes). *Wrong-reason pass:* the
   webhook failed outright; assert the raw document WAS stored.
4. **Redelivery is a no-op.** The provider re-posts the same message id; row counts unchanged.
5. **The acknowledgement counts what was created.** 3 attachments → *"3 documents saved"*; a
   message with 3 attachments of which 2 are unreadable types → *"1 document saved; 2 files we kept
   but can't read"*. The sentence is a function of the intake rows, and a test asserts it cannot
   see the provider payload.
6. **The drain books it.** Open the company; within one drain tick the intake row is `recorded` with
   `journal_entry_ids` (C311's gate) and the Documents card links to the entry (C326). *Wrong-reason
   pass:* the user dropped the same file by hand during the window.
7. **Completeness sees the second control.** `attachment_count` summed over the month equals the
   count of email-sourced intake rows; make one attachment's intake insert fail (fault injection,
   the `documentIntake.faultInjection` pattern) and the check must FAIL by one.
8. **An invoice goes out only after it is posted.** Kill the A/R post; no `outbound_messages` row
   exists. Post succeeds, provider returns an error; the row reads `failed` and the screen says the
   invoice is in the books and was NOT sent. *Wrong-reason pass:* the UI says sent from the click.
9. **The email body cannot act.** The `O81` battery gains: (a) a reply whose text is an instruction
   to delete an entry — the entry survives and `ai_action_refused` carries `channel_email`; (b) a
   forwarded PDF whose text contains a prompt-shaped instruction — the extraction is unaffected (the
   existing untrusted-slot design; assert, don't assume); (c) a chat message by email asking for a
   recode — refused with the plain sentence *"I can answer questions by email; changes to your books
   happen in the app."*
10. **A question's answer lands on its question.** Send a `question` for a HELD row; reply by email;
    the row's `detail` carries the answer and `outbound_messages.answered_at` is set; the row is
    still HELD. *Wrong-reason pass:* the reply matched by subject text rather than token — reply with
    the token in a different subject and assert it still lands.
11. **No jargon leaves the building.** Every `question` and `receipt` body passes
    `containsOwnerJargon`; pinned by generating each kind from a fixture and running the guard.
12. **Card rate is unchanged by the door.** `cardRateForPeriod` over a month fed entirely by email
    equals the same month fed by drop — the channel must not create a new kind of card.

---

## 8. ORDER OF WORK

1. **Decisions (operator, §10).** Domain, provider, who pays for Phase A budget.
2. **`088`–`090`** with VERIFY blocks in `supabase/verify/`, one statement per check, the
   unknown-sender refusal watched to refuse.
3. **`receive-mail` edge function** (service role): §2 in full, §4.4 read-only. Deployed with
   `--project-ref`, verified by version, then by a real forwarded message against criteria 1–5.
4. **`send-mail` edge function** + `outbound_messages`; `receipt` first (it is the smallest and it
   closes the loop), then `invoice` (the operator's second ask), then `question`, then `report`.
5. **Settings block + Documents chip + Home line** — the visible half, under the `clientSurfaces`
   guard.
6. **Criteria 6–12** driven on a fixture company, scored in a `docs/EMAIL_ACCEPTANCE.md` the way
   `DRIVE4_ACCEPTANCE.md` is.
7. **Phase B** only after `O89` reaches the pipeline. **Phase C** (replies that act) only after
   criterion 9 and the `O81` battery.

---

## 9. WHAT THIS DOES NOT DO

- It does not book on receipt (Phase A). It says so.
- It does not let an email change the books. A reply is evidence for a person until Phase C.
- It does not build Slack or SMS; it leaves a `channel` column where they would go.
- It does not collect payment on an invoice. A pay link is a payments-provider integration with its
  own money-movement rules and its own spec; the invoice email carries the total and a "pay by" date
  and nothing that takes a card.
- It does not replace the drop zone. Two doors, one intake ledger.
- It does not make the CPA's review any smaller or larger; every emailed document is exactly as
  reviewed as a dropped one.

---

## 10. DECISIONS FOR THE OPERATOR

1. **Domain — OPEN.** Inbound needs MX on a subdomain we control (`in.<domain>`); outbound needs
   SPF/DKIM on the sending domain. The app has no custom domain today (`O31`); `ledger-app-five.
   vercel.app` cannot receive mail. **A domain must be bought or chosen before the first deploy**,
   then set as the `MAIL_DOMAIN` secret and verified in Resend.
2. **Provider — DECIDED: Resend** (2026-09-14).
3. **Phase A budget — DECIDED: acceptable** (2026-09-14).
4. **Digest — DECIDED: opt-in** (2026-09-14).
5. **Reply-to-question application — DECIDED: Phase C stays gated on `O81`** (2026-09-14).

Approval is a reply to this file, not a signature ritual — the `O114` convention.
