import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../lib/constants";

// Default fallbacks keyed by stable system_role, so role lookups still resolve
// before accounts have loaded or if a company is missing a given role.
const DEFAULT_BY_ROLE = {};
const DEFAULT_BY_CODE = {};
for (const a of DEFAULT_CHART_OF_ACCOUNTS) {
  if (a.system_role) DEFAULT_BY_ROLE[a.system_role] = a;
  DEFAULT_BY_CODE[a.code] = a;
}

// O108 — roles already warned about, so the signal is once-per-role, not once-per-render.
// Module-scoped deliberately: it should not reset when a component remounts.
const WARNED_ROLE_FALLBACKS = new Set();

// Loads a company's chart of accounts from Supabase and resolves accounts by
// stable system_role (never a hardcoded code), by code, or by id. The whole app
// references roles so users can freely rename/renumber accounts.
export function useAccounts(companyId) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) { setAccounts([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("accounts").select("*").eq("company_id", companyId).order("code");
      if (error) { console.warn("[accounts] load failed:", error.message); }
      else if (data) {
        setAccounts(data.map(a => ({
          id: a.id, db_id: a.id, code: a.code, name: a.name, category: a.category,
          active: a.active, is_system: a.is_system, system_role: a.system_role,
          parent_code: a.parent_code,
        })));
      }
    } catch (e) { console.warn("[accounts] load error:", e?.message || e); }
    finally { setLoading(false); }
  }, [companyId]);

  // (Re)fetch whenever the company changes.
  useEffect(() => { load(); }, [load]);

  const byRole = useMemo(() => {
    const m = {};
    for (const a of accounts) if (a.system_role) m[a.system_role] = a;
    return m;
  }, [accounts]);
  const byCode = useMemo(() => {
    const m = {};
    for (const a of accounts) m[a.code] = a;
    return m;
  }, [accounts]);
  const byId = useMemo(() => {
    const m = {};
    for (const a of accounts) m[a.id] = a;
    return m;
  }, [accounts]);

  // role -> full account object. Falls back to the default chart so callers can
  // safely read .code / .name even before the company's accounts have loaded.
  //
  // ── O108 finding 4 — THE FALLBACK IS NOW AUDIBLE (C201-adjacent, no behaviour change) ──
  // This fallback is load-bearing and was, until 2026-08-17, completely silent: a role
  // missing from the company's chart resolved to the client's HARDCODED chart and returned a
  // plausible, fully-formed account object with a code. The caller then built a journal entry
  // from it, and `ensureAccount` INSERTED that code into the company's chart — so a role gap
  // never failed, it MATERIALISED. It had fired three times on Franklin Ave (3400, 6520, 6530)
  // across attested months before anyone knew the mechanism existed.
  //
  // The fallback itself is deliberately UNCHANGED. Removing it turns silent materialisation
  // into hard failures on live booking paths — a separate decision with its own blast radius.
  // Making it audible costs nothing and ends the invisibility, which is the actual defect.
  //
  // Warned ONCE PER ROLE, and only after accounts have loaded — before load `byRole` is
  // legitimately empty and every lookup would warn, which is how a useful signal becomes noise
  // people filter out.
  const getAccountByRole = useCallback(
    (role) => {
      const own = byRole[role];
      if (own) return own;
      const fallback = DEFAULT_BY_ROLE[role] || null;
      if (fallback && accounts.length && !WARNED_ROLE_FALLBACKS.has(role)) {
        WARNED_ROLE_FALLBACKS.add(role);
        console.warn(
          `[accounts] O108: role "${role}" is not in this company's chart — falling back to the built-in chart ` +
          `(${fallback.code} ${fallback.name}). Anything booked from this will materialise ${fallback.code} ` +
          `with system_role NULL.`
        );
      }
      return fallback;
    },
    [byRole, accounts.length]
  );
  const getAccountByCode = useCallback(
    (code) => byCode[code] || DEFAULT_BY_CODE[code] || null,
    [byCode]
  );
  const getAccountById = useCallback((id) => byId[id] || null, [byId]);

  return { accounts, loading, reload: load, getAccountByRole, getAccountByCode, getAccountById };
}

export default useAccounts;
