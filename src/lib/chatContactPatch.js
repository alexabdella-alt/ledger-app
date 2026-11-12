// C609 — what an assistant write may change on a contact that ALREADY exists: only the fields
// it actually supplied. Never the name or company, never a blank over a saved value, never the
// type unless one was stated (a missing type defaults to "vendor", which is not a statement).
export function chatContactPatch(payload = {}, { typeGiven = false } = {}) {
  return Object.fromEntries(Object.entries(payload || {}).filter(([k, v]) =>
    k !== "company_id" && k !== "name"
    && v != null && v !== ""
    && !(Array.isArray(v) && v.length === 0)
    && !(k === "type" && !typeGiven)));
}
