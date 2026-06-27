import React from "react";

// Terms of Service + Privacy Policy (Item 18). Self-contained (no app context) so
// it works both inside the app and on the pre-login auth screen.
// Plain English, professional, and protective of the operator.

const EFFECTIVE = "June 2026";
const PRODUCT = "Shadow";
const SUPPORT_EMAIL = "support@shadowcfo.app"; // placeholder — update before launch

const s = {
  page: { minHeight: "100%", background: "var(--sc-bg)", fontFamily: "'DM Sans', system-ui, sans-serif", color: "var(--sc-text)" },
  wrap: { maxWidth: 760, margin: "0 auto", padding: "28px 24px 64px" },
  h1: { fontSize: 28, fontWeight: 700, letterSpacing: -0.5, margin: "0 0 4px" },
  meta: { fontSize: 12, color: "var(--sc-text-mut)", marginBottom: 20 },
  card: { background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 16, padding: "28px 32px" },
  h2: { fontSize: 16, fontWeight: 700, color: "var(--sc-text)", margin: "26px 0 8px" },
  p: { fontSize: 14, lineHeight: 1.7, color: "var(--sc-text-2)", margin: "0 0 10px" },
  li: { fontSize: 14, lineHeight: 1.7, color: "var(--sc-text-2)", margin: "0 0 6px" },
  note: { fontSize: 13, color: "var(--sc-text-2)", background: "var(--sc-bg)", border: "1px solid var(--sc-border)", borderRadius: 10, padding: "12px 14px", margin: "14px 0", lineHeight: 1.6 },
  tab: (active) => ({ padding: "8px 16px", borderRadius: 20, fontSize: 13, fontWeight: active ? 600 : 500, cursor: "pointer", border: `1px solid ${active ? "var(--sc-gold)" : "var(--sc-border-2)"}`, background: active ? "var(--sc-gold)" : "transparent", color: active ? "var(--sc-surface)" : "var(--sc-text-2)" }),
  back: { background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 9, padding: "7px 14px", fontSize: 13, color: "var(--sc-text-2)", cursor: "pointer", fontWeight: 600 },
};

function Terms() {
  return (
    <div>
      <h2 style={{ ...s.h2, marginTop: 0 }}>1. The service</h2>
      <p style={s.p}>{PRODUCT} is AI-assisted accounting and bookkeeping software with CPA oversight. The software ingests the documents you provide (invoices, receipts, bank statements, contracts), extracts and categorizes the data, records double-entry journal entries, and surfaces reports, estimates, and plain-English answers about your books. A licensed CPA reviews the methodology and provides oversight of the accounting workflows; this is software plus professional review, not a substitute for a tax preparer or attorney engaged for your specific situation.</p>

      <h2 style={s.h2}>2. Your responsibilities</h2>
      <p style={s.p}>You are responsible for the accuracy and completeness of the documents and information you upload. The software's output is only as good as the inputs you give it. You are responsible for reviewing booked entries, categorizations, and reports before relying on them or sharing them with third parties.</p>
      <p style={s.p}>You are responsible for the security of your account, including keeping your password confidential and notifying us promptly of any unauthorized access. You must be authorized to upload any data you submit and to bind the business whose books you manage.</p>

      <h2 style={s.h2}>3. Scope of service</h2>
      <p style={s.p}>The service provides bookkeeping software and CPA review of accounting methodology. It produces planning-level tax estimates and general guidance grounded in your ledger. It does <strong>not</strong> provide filing-level tax advice tailored to every situation, legal advice, audit or attest services, or a guarantee of any particular tax outcome. Estimated figures (taxes owed, deductions, runway, valuations, ratios) are planning aids, not filed positions.</p>

      <h2 style={s.h2}>4. Data ownership and export</h2>
      <p style={s.p}>You own your data. We claim no ownership over the financial records, documents, or business information you upload. You can export your data at any time from within the application (CSV exports and document downloads), and you may request a full export by contacting us. We retain a license to process your data only as needed to operate and improve the service for you, as described in our Privacy Policy.</p>

      <h2 style={s.h2}>5. Limitation of liability</h2>
      <p style={s.p}>The service is provided "as is" and "as available," without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. Numbers produced by the software — including tax estimates, deductions, and financial projections — are planning estimates and may contain errors. <strong>You should confirm any filing, payment, or material business decision with a qualified tax professional or accountant before acting.</strong></p>
      <p style={s.p}>To the maximum extent permitted by law, we are not liable for any indirect, incidental, special, consequential, or punitive damages, or for lost profits, lost data, or business interruption, arising out of or related to your use of the service. Our total aggregate liability for any claim arising out of or relating to the service will not exceed the amount you paid us for the service in the twelve (12) months preceding the event giving rise to the claim.</p>

      <h2 style={s.h2}>6. Acceptable use</h2>
      <p style={s.p}>You agree not to: use the service for any unlawful purpose or to record fraudulent transactions; upload another party's data without authorization; attempt to access other tenants' data or circumvent the application's security and isolation controls; reverse engineer, scrape, or overload the service; or use the service to build a competing product. We may suspend accounts that violate these terms.</p>

      <h2 style={s.h2}>7. Subscription and billing</h2>
      <p style={s.p}>Paid plans are billed through our payment processor (Stripe). Fees, billing cadence, trial terms, and plan limits are presented at the point of purchase. <em>(Billing details and refund terms will be finalized here when paid plans launch.)</em> You authorize us and Stripe to charge your payment method for the applicable fees. Taxes may apply.</p>

      <h2 style={s.h2}>8. Termination and data deletion</h2>
      <p style={s.p}>You may stop using the service and request account closure at any time. We may suspend or terminate accounts that violate these terms or for non-payment. On request, we will delete your data within a commercially reasonable period, except where retention is required by law or for legitimate record-keeping. We recommend exporting your data before requesting deletion, as deletion is permanent.</p>

      <h2 style={s.h2}>9. Governing law</h2>
      <p style={s.p}>These terms are governed by the laws of the State of Texas, without regard to its conflict-of-laws rules. The exclusive venue for any dispute arising out of or relating to the service or these terms will be the state and federal courts located in Texas, and you consent to their jurisdiction.</p>

      <h2 style={s.h2}>10. Changes</h2>
      <p style={s.p}>We may update these terms from time to time. Material changes will be reflected by updating the effective date above and, where appropriate, by notice within the application. Your continued use of the service after changes take effect constitutes acceptance.</p>

      <div style={s.note}>Questions about these terms? Contact us at {SUPPORT_EMAIL}.</div>
    </div>
  );
}

function Privacy() {
  return (
    <div>
      <h2 style={{ ...s.h2, marginTop: 0 }}>1. Information we collect</h2>
      <p style={s.p}>We collect the information you give us to provide the service:</p>
      <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
        <li style={s.li}><strong>Financial documents and transactions</strong> — invoices, receipts, bank statements, contracts, journal entries, and the figures derived from them.</li>
        <li style={s.li}><strong>Account information</strong> — your name, email, company details, and authentication credentials (passwords are hashed; we never store them in plain text).</li>
        <li style={s.li}><strong>Usage data</strong> — basic, non-financial diagnostics (e.g., error reports) used to keep the product reliable. Financial data is stripped from error reports before they leave your browser.</li>
      </ul>

      <h2 style={s.h2}>2. How we use it</h2>
      <p style={s.p}>We use your information solely to provide and improve the service for you: extracting and categorizing your documents, booking entries, generating reports and estimates, answering your questions, and improving the accuracy of the AI's categorization for your business. We do not use your financial data for advertising.</p>

      <h2 style={s.h2}>3. Processors and sharing</h2>
      <p style={s.p}>We rely on a small set of trusted infrastructure providers to operate the service:</p>
      <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
        <li style={s.li}><strong>Supabase</strong> — secure database, authentication, and file storage for your data.</li>
        <li style={s.li}><strong>Anthropic</strong> — AI processing of your documents and questions. Requests are sent through our server-side proxy; your data is processed to generate output and is not used by us to train models.</li>
        <li style={s.li}><strong>Stripe</strong> — payment processing for paid plans (handles your payment details; we never store full card numbers).</li>
      </ul>
      <p style={s.p}><strong>We never sell your data.</strong> We share data with processors only as needed to run the service, and we do not share your financial information with third parties for their own purposes.</p>

      <h2 style={s.h2}>4. Data retention and deletion</h2>
      <p style={s.p}>We retain your data for as long as your account is active so the service can function. Deleted entries are soft-deleted (recoverable for a period and preserved in your audit trail) before permanent removal. On request, we will delete your account and associated data within a commercially reasonable period, except where retention is required by law. You can export your data at any time before deletion.</p>

      <h2 style={s.h2}>5. Security</h2>
      <p style={s.p}>Your data is isolated per company using database row-level security (RLS), so one tenant can never read another's data. Data is encrypted in transit (TLS) and at rest by our infrastructure providers. Server-only secrets (such as the AI provider key) never reach the browser, and access is gated by authenticated sessions. No system is perfectly secure, but we design for least-privilege access and tenant isolation by default.</p>

      <h2 style={s.h2}>6. Your rights</h2>
      <p style={s.p}>You can access and export your data from within the application at any time. You can request correction or deletion of your data by contacting us. Depending on your jurisdiction, you may have additional rights regarding your personal information; we will honor applicable rights on verified request.</p>

      <h2 style={s.h2}>7. Children</h2>
      <p style={s.p}>The service is for businesses and is not directed to individuals under 18. We do not knowingly collect information from children.</p>

      <h2 style={s.h2}>8. Changes and contact</h2>
      <p style={s.p}>We may update this policy and will revise the effective date above when we do. For questions, data export requests, or deletion requests, contact us at {SUPPORT_EMAIL}.</p>

      <div style={s.note}>Plain-English summary: your books are yours, isolated per company, encrypted, never sold, processed only to run the service, and exportable or deletable on request.</div>
    </div>
  );
}

export default function LegalView({ initialTab = "terms", onBack }) {
  const [tab, setTab] = React.useState(initialTab === "privacy" ? "privacy" : "terms");
  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setTab("terms")} style={s.tab(tab === "terms")}>Terms of Service</button>
            <button onClick={() => setTab("privacy")} style={s.tab(tab === "privacy")}>Privacy Policy</button>
          </div>
          {onBack && <button onClick={onBack} style={s.back}>← Back</button>}
        </div>

        <h1 style={s.h1}>{tab === "terms" ? "Terms of Service" : "Privacy Policy"}</h1>
        <div style={s.meta}>{PRODUCT} · Effective {EFFECTIVE}</div>

        <div style={s.card}>
          {tab === "terms" ? <Terms /> : <Privacy />}
        </div>
      </div>
    </div>
  );
}
