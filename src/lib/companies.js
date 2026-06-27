// Choose which company to make active on load. Prefer the last-selected company (so a
// refresh restores where the user was working — never silently drop a multi-company
// user into the wrong company's books), but only if it's still in their accepted list;
// otherwise fall back to the first. Pure → unit-tested.
export function pickActiveCompany(cos, lastId) {
  const list = Array.isArray(cos) ? cos : [];
  if (lastId != null && lastId !== "") {
    const found = list.find(c => String(c?.id) === String(lastId));
    if (found) return found;
  }
  return list[0] || null;
}
