import React from "react";
import * as DS from "./drillStack";

// React wrapper around the pure drillStack. Every drill-down uses this so forward/back/jump
// behave identically everywhere. `labelOf(layer,i)` names layers for the breadcrumb.
export function useDrillStack({ rootLabel = "Home", labelOf } = {}) {
  const [s, setS] = React.useState(DS.emptyDrill);
  return {
    state: s,
    current: DS.current(s),
    depth: DS.depth(s),
    canBack: DS.canBack(s),
    canForward: DS.canForward(s),
    crumbs: DS.breadcrumb(s, labelOf, rootLabel),
    push: (layer) => setS(prev => DS.push(prev, layer)),
    back: () => setS(prev => DS.back(prev)),
    forward: () => setS(prev => DS.forward(prev)),
    jumpTo: (index) => setS(prev => DS.jumpTo(prev, index)),
    reset: () => setS(DS.emptyDrill()),
  };
}
