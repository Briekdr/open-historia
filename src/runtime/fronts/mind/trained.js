/*! Open Historia — battlefields and fronts: the trained staff the lab can switch on (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. The staff a training run produced (weights.js,
// written by tools/strategy-nn/export.mjs), as the engine takes one
// (policy.js). null where none is shipped or its weights do not fit this
// build's network: the engine's own scripted staff then decides, as ever.
//
// Where no network is shipped (Wars and Fronts Pt.2), it is the staff that
// looks ahead (planner.js), with the weights plannerWeights.js ships: "put that
// current model on 3319 for me to test" (the owner, 2026-10-14).
//
// It is used only when the lab's switch is on (Game/AI/frontsGate.js
// strategyNetOn).

import { readWeights } from "./net.js";
import { LATE_AT, PLAN_PARAMS, createPlainerPlanner, createPlanner, plainPlanner, withLateEval } from "./planner.js";
import { meantLoserOf, normalizeWarOutcomes } from "../../warOutcomes.js";
import { SHIPPED_PLANNER } from "./plannerWeights.js";
import { createStaffPolicy, createTroopPolicy } from "./policy.js";
import { TRAINED_STAFF } from "./weights.js";

let made = false;
let policy = null;

// The weights the staff that looks ahead is shipped with: a champion's that fit, or its plain ones.
// (Weights made before the later weighing, LATE_AT long, are read with it at its defaults: planner.js withLateEval.)
export const shippedPlannerParams = () => (Array.isArray(SHIPPED_PLANNER?.params) && (SHIPPED_PLANNER.params.length === PLAN_PARAMS || SHIPPED_PLANNER.params.length === LATE_AT) && SHIPPED_PLANNER.params.every(Number.isFinite)
  ? withLateEval(SHIPPED_PLANNER.params)
  : plainPlanner());

export const trainedStaffPolicy = () => {
  if (made) return policy;
  made = true;
  const weights = readWeights(TRAINED_STAFF);
  // (Weights with a head order troops one by one; without, the side as a whole; none, the staff that looks ahead.)
  policy = !weights ? createPlanner({ params: shippedPlannerParams() }) : weights.shape.head > 0 ? createTroopPolicy(weights) : createStaffPolicy(weights);
  return policy;
};

// The lab's staff for a run: the trained one, and for a side a war is meant to lose the plainer commander
// (planner.js PLAINER_PLANNER; runtime/warOutcomes.js). The run's own record of a war is looked for first, then
// `wars` (the world's, as the turn's war records leave them: a war the story opened this turn is among them).
//   outcomes   the scenario's (warSettings.outcomes)
export const labStaffPolicy = ({ wars = [], outcomes = [] } = {}) => {
  const trained = trainedStaffPolicy();
  if (!trained) return null;
  const records = new Map((Array.isArray(wars) ? wars : []).filter((war) => war?.id).map((war) => [String(war.id), war]));
  const rules = normalizeWarOutcomes(outcomes);
  if (rules.length === 0 && ![...records.values()].some((war) => war.meantWinner)) return trained;
  const plainer = createPlainerPlanner();
  // Who leads a side of a battle: "plainer" or "trained".
  const commanderFor = (battle, side) => (meantLoserOf({ war: records.get(String(battle?.warId ?? "")) ?? null, sides: battle?.sides, outcomes: rules }) === side ? "plainer" : "trained");
  const policy = (battle, side, context, run) => (commanderFor(battle, side) === "plainer" ? plainer : trained)(battle, side, context, run);
  policy.often = trained.often === true;
  policy.commanderFor = commanderFor;
  return policy;
};

// What is shipped, for whoever looks: { run, round, score, overStaff, overAdvance, troops } or null.
export const trainedStaffInfo = () => (TRAINED_STAFF
  ? { run: TRAINED_STAFF.run, round: TRAINED_STAFF.round, score: TRAINED_STAFF.score, overStaff: TRAINED_STAFF.overStaff, overAdvance: TRAINED_STAFF.overAdvance, troops: TRAINED_STAFF.shape?.head > 0 }
  : { planner: true, run: SHIPPED_PLANNER?.run ?? "plain", champion: SHIPPED_PLANNER?.champion ?? 0 });
