import { useState } from "react";

// Persists the active view to localStorage so it survives ERP remounts
export function usePersistedView() {
  const [view, setView] = useState(() => {
    try { return localStorage.getItem("cfai_view") || "dashboard"; } catch { return "dashboard"; }
  });
  const update = (v) => { setView(v); try { localStorage.setItem("cfai_view", v); } catch {} };
  return [view, update];
}
