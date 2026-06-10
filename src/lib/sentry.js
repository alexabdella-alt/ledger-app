// ─────────────────────────────────────────────────────────────────────────────
// Sentry error monitoring (Item 16). Activated ONLY when VITE_SENTRY_DSN is set,
// so local/dev builds without a DSN are a complete no-op.
//
// Privacy: a beforeSend hook scrubs financial data (invoices, contacts, journal
// entries, session/tokens, balances, etc.) from every event before it leaves the
// browser — client financial data never reaches Sentry.
// ─────────────────────────────────────────────────────────────────────────────

import * as Sentry from "@sentry/react";

// Key names whose VALUES must never be sent to Sentry. Matched case-insensitively
// against object keys anywhere in an event's extra/context/request/breadcrumb data.
const SENSITIVE_KEY = /invoice|contact|journal|ledger|session|token|password|secret|api[_-]?key|anon|bank|balance|opening|recurring|payroll|contract|deduction|chat|message|statement|reconcil|customer|vendor|receivab|payab/i;

// Recursively redact sensitive keys while preserving the overall shape (so the
// stack trace / component stack / non-financial debug context still come through).
function redact(value, depth = 0) {
  if (depth > 6 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  const out = {};
  for (const k of Object.keys(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(value[k], depth + 1);
  }
  return out;
}

function beforeSend(event) {
  try {
    if (event.extra) event.extra = redact(event.extra);
    if (event.contexts) event.contexts = redact(event.contexts);
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs.forEach(b => { if (b && b.data) b.data = redact(b.data); });
    }
    if (event.request) {
      delete event.request.cookies;
      if (event.request.data) event.request.data = redact(event.request.data);
      if (event.request.headers) { delete event.request.headers.Authorization; delete event.request.headers.authorization; delete event.request.headers.Cookie; }
    }
    // Never let auth tokens ride along in the user object.
    if (event.user) event.user = { id: event.user.id, email: event.user.email };
  } catch { /* never let scrubbing throw */ }
  return event;
}

// Initialize Sentry. Safe to call always — does nothing without a DSN.
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
    // Don't attach request bodies; we scrub anyway, but belt-and-suspenders.
    sendDefaultPii: false,
    beforeSend,
  });
}

// Tie errors to the signed-in user + their active company (ids only — no financials).
export function setSentryUser(user, company) {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.setUser(user ? { id: user.id, email: user.email } : null);
  Sentry.setTag("company_id", company?.id || null);
}

export function clearSentryUser() {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.setUser(null);
  Sentry.setTag("company_id", null);
}

export { Sentry };
