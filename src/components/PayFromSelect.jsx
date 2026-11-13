import React from "react";
import { useERP } from "./ERPContext";
import { payFromOptions } from "../lib/payFrom";

// C674 — the "Paid from" choice on every bill-payment form. `value` is an option key;
// `onChange(key)`. The caller passes the chosen option to markPaid as `payFrom`.
export function usePayFromOptions() {
  const { bankAccounts, getAccountByRole, CHART_OF_ACCOUNTS, companySettings } = useERP();
  return React.useMemo(() => payFromOptions({ bankAccounts: bankAccounts || [], getAccountByRole: getAccountByRole || (() => null),
    chart: CHART_OF_ACCOUNTS || [], legalForm: companySettings?.legalForm || "" }), [bankAccounts, getAccountByRole, CHART_OF_ACCOUNTS, companySettings?.legalForm]);
}

export default function PayFromSelect({ value, onChange, style }) {
  const options = usePayFromOptions();
  if (options.length < 2) return null;   // one place it can have come from — nothing to ask
  return (
    <select data-pay-from aria-label="Paid from" value={value || options[0].key} onChange={(e) => onChange(e.target.value)} style={style}>
      {options.map((o) => <option key={o.key} value={o.key}>Paid from: {o.label}</option>)}
    </select>
  );
}
