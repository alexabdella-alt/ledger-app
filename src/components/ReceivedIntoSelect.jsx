import React from "react";
import { useERP } from "./ERPContext";
import { receivedIntoOptions } from "../lib/payFrom";

// C677 — the "Received into" choice when a customer's payment is recorded.
export function useReceivedIntoOptions() {
  const { bankAccounts, getAccountByRole } = useERP();
  return React.useMemo(() => receivedIntoOptions({ bankAccounts: bankAccounts || [], getAccountByRole: getAccountByRole || (() => null) }), [bankAccounts, getAccountByRole]);
}

export default function ReceivedIntoSelect({ value, onChange, style }) {
  const options = useReceivedIntoOptions();
  if (options.length < 2) return null;
  return (
    <select data-received-into aria-label="Received into" value={value || options[0].key} onChange={(e) => onChange(e.target.value)} onClick={(e) => e.stopPropagation()} style={style}>
      {options.map((o) => <option key={o.key} value={o.key}>Received into: {o.label}</option>)}
    </select>
  );
}
