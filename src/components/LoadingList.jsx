import React from "react";

// C428 — rendered in place of a screen's empty state while the company is still loading.
// "No vendors yet" flashed for the length of the load on every records screen, which is an
// empty result claimed before the query answered (O98's transient cousin).
export default function LoadingList({ what = "this" }) {
  return (
    <div data-loading-list style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: 32, textAlign: "center", color: "var(--sc-text-mut)", fontSize: 13 }}>
      Loading {what}…
    </div>
  );
}
