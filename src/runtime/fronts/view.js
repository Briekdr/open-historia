/*! Open Historia — battlefields and fronts: what one government may see of one © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// There is no fog of war here: a battlefield is seen whole, the line, both
// sides' troops, what has been taken and lost. What a government keeps to
// itself is what it has told its own side to do next, and what it holds in
// reserve. In a shared game those two are all that is held back from the other
// side (multiplayer/host/projection.js); the prompt's text for a battlefield
// leaves the same out for a leader on the other side (brief.js).

import { battlefieldSideOf } from "./record.js";

// A battlefield as `viewer` (a country or a group) is sent it. `field` is the
// engine's own bookkeeping and stays with whoever runs the engine: a map that
// only draws reads the saved moments.
export const battlefieldForViewer = (battlefield, viewer) => {
  if (!battlefield || typeof battlefield !== "object") return battlefield;
  const side = battlefieldSideOf(battlefield, viewer);
  const { field: _field, ...seen } = battlefield;
  return {
    ...seen,
    orders: (Array.isArray(battlefield.orders) ? battlefield.orders : []).filter((order) => order?.s === side),
    pool: [0, 1].map((index) => (index === side ? Number(battlefield.pool?.[index]) || 0 : 0)),
  };
};

export const battlefieldsForViewer = (battlefields, viewer) =>
  (Array.isArray(battlefields) ? battlefields : []).map((battlefield) => battlefieldForViewer(battlefield, viewer));
