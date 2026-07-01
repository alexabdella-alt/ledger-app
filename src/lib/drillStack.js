// ─────────────────────────────────────────────────────────────────────────────
// Onion-layer drill navigation — ONE shared mechanism every drill-down uses.
//
// Model: drilling IN pushes a layer; BACK pops exactly ONE layer (retracing the path,
// never jumping to the top); FORWARD re-advances a popped layer (browser-style history);
// a breadcrumb shows the trail and can JUMP to any level. Back from the first drill layer
// pops to the empty stack = the screen the drill sits on (that's "one layer out"), it never
// clears multiple levels at once.
//
// State is a plain value { stack: Layer[], forward: Layer[] } so it's trivially serialisable
// and unit-testable; the React wrapper lives in useDrillStack.js. A `Layer` is any object the
// caller wants (e.g. { type:"cash" }, { type:"expenses", cat:"Rent" }, { type:"txn", id }).
// ─────────────────────────────────────────────────────────────────────────────

export const emptyDrill = () => ({ stack: [], forward: [] });

// Drill one layer deeper. Pushing a new layer abandons any forward history (a new branch).
export function push(s, layer) {
  return { stack: [...(s?.stack || []), layer], forward: [] };
}

// Back exactly ONE layer — the popped layer becomes re-advanceable via forward().
export function back(s) {
  const stack = s?.stack || [];
  if (!stack.length) return s || emptyDrill();
  const top = stack[stack.length - 1];
  return { stack: stack.slice(0, -1), forward: [top, ...(s.forward || [])] };
}

// Forward re-advances the most-recently-popped layer.
export function forward(s) {
  const fwd = s?.forward || [];
  if (!fwd.length) return s || emptyDrill();
  const [next, ...rest] = fwd;
  return { stack: [...(s.stack || []), next], forward: rest };
}

// Jump straight to a breadcrumb level. index -1 = the root (exit the drill). A deliberate jump
// clears forward history (you've chosen a new position, not stepped back).
export function jumpTo(s, index) {
  const stack = s?.stack || [];
  if (index < -1 || index >= stack.length) return s || emptyDrill();
  if (index === -1) return emptyDrill();
  return { stack: stack.slice(0, index + 1), forward: [] };
}

export const reset = () => emptyDrill();
export const current = (s) => { const st = s?.stack || []; return st.length ? st[st.length - 1] : null; };
export const depth = (s) => (s?.stack || []).length;
export const canBack = (s) => (s?.stack || []).length > 0;        // back one level (last level → the screen)
export const canForward = (s) => (s?.forward || []).length > 0;

// Breadcrumb trail. `labelOf(layer, i)` names each drill layer; `rootLabel` is the screen.
// Returns [{ label, index }] where index -1 is the root and 0..n-1 are the drill layers.
export function breadcrumb(s, labelOf, rootLabel = "Home") {
  const stack = s?.stack || [];
  return [{ label: rootLabel, index: -1 }, ...stack.map((l, i) => ({ label: (labelOf ? labelOf(l, i) : String(i)), index: i, layer: l }))];
}
