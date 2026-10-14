/*! Open Historia — battlefields and fronts: the trained staff the lab can switch on (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. The staff a training run produced (weights.js,
// written by tools/strategy-nn/export.mjs), as the engine takes one
// (policy.js). null where none is shipped or its weights do not fit this
// build's network: the engine's own scripted staff then decides, as ever.
//
// It is used only when the lab's switch is on (Game/AI/frontsGate.js
// strategyNetOn): in the browser's console, localStorage.setItem("oh:strategyNet", "1").

import { readWeights } from "./net.js";
import { createStaffPolicy, createTroopPolicy } from "./policy.js";
import { TRAINED_STAFF } from "./weights.js";

let made = false;
let policy = null;

export const trainedStaffPolicy = () => {
  if (made) return policy;
  made = true;
  const weights = readWeights(TRAINED_STAFF);
  // (Weights with a head order troops one by one; without, the side as a whole.)
  policy = !weights ? null : weights.shape.head > 0 ? createTroopPolicy(weights) : createStaffPolicy(weights);
  return policy;
};

// What is shipped, for whoever looks: { run, round, score, overStaff, overAdvance, troops } or null.
export const trainedStaffInfo = () => (TRAINED_STAFF ? { run: TRAINED_STAFF.run, round: TRAINED_STAFF.round, score: TRAINED_STAFF.score, overStaff: TRAINED_STAFF.overStaff, overAdvance: TRAINED_STAFF.overAdvance, troops: TRAINED_STAFF.shape?.head > 0 } : null);
