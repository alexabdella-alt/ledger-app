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
