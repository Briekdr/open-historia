/*! Open Historia — battlefields and fronts: a day's morning and evening © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2. The MORNING of a battle's day, before its staff looks
// and before anyone moves (engine.js stepDay): what the day's conditions make
// of each troop, as three numbers that the fight and the march only multiply
// by (combat.js):
//
//   punch   its attack
//   guard   its defence
//   legs    its pace
//
// Each is 1 unless a mechanic of the run's says otherwise (mechanics.js), so a
// run with none on is the run it always was, to the last digit.
//
// The EVENING, before the day's books are closed (day.js simulateDay): what
// the day did to each troop.
//
// Only + - * / and comparisons.

import { anyMechanic } from "./mechanics.js";
import { isLive } from "./troops.js";

// (A test may set a side's readiness outright: input.steering.readiness = { punch: [a, b], guard, legs }.)
const steered = (run, key, side) => {
  const list = run.steer?.readiness?.[key];
  const value = Array.isArray(list) ? Number(list[side]) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : 1;
};

// Whether the mornings of a run have anything to do.
export const dawnsOn = (run) => anyMechanic(run.mech) || Boolean(run.steer?.readiness);

export const dawn = (run, battle, day) => {
  if (!dawnsOn(run)) return;
  for (const side of [0, 1]) {
    const punch = steered(run, "punch", side);
    const guard = steered(run, "guard", side);
    const legs = steered(run, "legs", side);
    for (const troop of battle.troops[side]) {
      if (!isLive(troop)) continue;
      troop.punch = punch;
      troop.guard = guard;
      troop.legs = legs;
    }
  }
};

export const dusk = (run, battle, day) => {
  if (!anyMechanic(run.mech)) return;
};
