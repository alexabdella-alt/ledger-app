import React from "react";
import { loadFailedCopy } from "../lib/loadFailures";

// C409 — rendered in place of a screen's empty state when the table behind it did not
// load. `data-load-failed` names the table so a test can tell it from the empty state.
export default function LoadFailedNotice({ what, table }) {
  return (
    <div data-load-failed={table} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-warning)", borderRadius: 14, padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>⚠</div>
      <div style={{ fontSize: 14, color: "var(--sc-text-2)", maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>{loadFailedCopy(what)}</div>
    </div>
  );
}
