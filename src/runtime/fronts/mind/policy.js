/*! Open Historia — battlefields and fronts: a network as a side's staff (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only (net.js). A side nobody plays has a STAFF, which
// decides what it does every few days (staff.js): a few written rules about
// who began the war and who is the stronger. This is the same staff with a
// trained network in its place.
//
// It is handed to a run as `staffPolicy` (engine.js reviewStaff) and asked,
// for each side nobody plays, at each of the staff's looks:
//
//   (battle, side, context, run) => { order, sector, draft } | undefined
//
// `undefined` leaves the side to the scripted staff. What it may decide is
// what the scripted staff may (dig in, hold, an attack on the stretch where
// it is strongest, a general advance), and one thing more: to DRAFT, which
// brings the side fresh formations at the cost of its country's people.
//
// Its memory (the network's own, and what it saw last time) is kept on the
// battle as `mind`, a list of numbers a side, and saved with the battlefield,
// so that it remembers from one turn of the game to the next.
//
// Only + - * / and comparisons: the same weights decide the same on every machine.

import { FEATURE_COUNT, MIND_ACTIONS, SEEN_COUNT, staffFeatures } from "./features.js";
import { step } from "./net.js";

// What the network says: four words for what the side does, then two for whether it drafts.
export const MIND_OUTPUTS = MIND_ACTIONS.length + 2;
export const MIND_SHAPE = Object.freeze({ inputs: FEATURE_COUNT, hidden: 12, outputs: MIND_OUTPUTS });

const round = (value) => Math.round(value * 1e4) / 1e4;

// The memory a side has on a battle: { state, seen }, blank on its first look.
const recall = (battle, side, hidden) => {
  const kept = Array.isArray(battle.mind?.[side]) ? battle.mind[side] : null;
  const state = new Float64Array(hidden);
  if (!kept || kept.length !== hidden + SEEN_COUNT) return { state, seen: null };
  for (let at = 0; at < hidden; at += 1) state[at] = Number(kept[at]) || 0;
  return { state, seen: kept.slice(hidden).map((value) => Number(value) || 0) };
};

//   weights   { shape, params, prior } (net.js readWeights)
//   prior     what is added to the word the scripted staff would say: with it
//             a network that knows nothing decides as the staff does, and
//             learns where to differ
//   drafts    whether it may call up fresh formations by itself. The scripted
//             staff never does (a draft is the story's to order, or a
//             player's), so a network that may is not being compared with it
//             like for like: off unless the weights were trained with it.
export const createStaffPolicy = ({ shape, params, prior = 0, drafts = false }) => {
  if (!shape || shape.inputs !== FEATURE_COUNT || shape.outputs !== MIND_OUTPUTS) return () => undefined;
  return (battle, side, context = {}, run = null) => {
    const memory = recall(battle, side, shape.hidden);
    const look = staffFeatures(battle, side, context, run, memory.seen);
    const { state, out } = step(shape, params, memory.state, look.x);
    if (!Array.isArray(battle.mind)) battle.mind = [[], []];
    battle.mind[side] = [...Array.from(state, round), ...look.seen.map(round)];
    let chosen = 0;
    let most = -Infinity;
    for (let at = 0; at < MIND_ACTIONS.length; at += 1) {
      const value = out[at] + (at === look.staff ? prior : 0);
      if (value > most) {
        most = value;
        chosen = at;
      }
    }
    const word = MIND_ACTIONS[chosen];
    const draft = drafts === true && out[MIND_ACTIONS.length + 1] > out[MIND_ACTIONS.length];
    if (word === "probe") return { order: "advance", sector: look.best || "all", draft, action: chosen };
    return { order: word, sector: "all", draft, action: chosen };
  };
};
