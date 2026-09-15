// C401 — at most ONE run at a time. `run(fn)` executes fn unless a previous run is still
// awaiting; a second call in that window returns `false` and runs nothing. `onBusy` is told
// when the window opens and closes (for disabling controls). Pure enough to test: the
// guard is a closure, not React state, because state lags a render and a double-click
// lands inside that lag.
export function makeOneInFlight({ onBusy = () => {}, blocked = () => false } = {}) {
  let inFlight = false;
  const run = async (fn) => {
    if (inFlight || blocked()) return false;
    inFlight = true; onBusy(true);
    try { return await fn(); }
    finally { inFlight = false; onBusy(false); }
  };
  return { run, isInFlight: () => inFlight };
}

// Keyed variant: one run per KEY at a time (one bill, one register, one recurring rule),
// so paying bill A does not block paying bill B while a second press on A runs nothing.
export function makeKeyedInFlight() {
  const keys = new Set();
  const run = async (key, fn) => {
    const k = String(key);
    if (keys.has(k)) return false;
    keys.add(k);
    try { return await fn(); }
    finally { keys.delete(k); }
  };
  return { run, isInFlight: (key) => keys.has(String(key)) };
}
