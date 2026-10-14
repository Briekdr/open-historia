/*! Open Historia — battlefields and fronts: a side nobody plays decides for itself © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A side of a battlefield that no person plays took its orders from the story
// and from nobody else. Where the story gave it none it held, for as long as
// it was given none: a front between two countries nobody plays lay still, and
// an enemy of the player's waited to be attacked.
//
// So such a side has a STAFF, which is the engine's own. Every few days it
// looks at how the side stands and decides what the side does, by two things:
//
//   who began the war   the side that began it is there to take ground, and
//                       attacks at odds a defender would only hold at. The
//                       side it was begun against defends, and goes over to
//                       the attack when it has clearly the stronger army.
//   how strong each is  what its troops are worth against the other side's,
//                       along the whole line and stretch by stretch.
//
//   much the stronger   a general advance along the whole line
//   the stronger        an attack on the stretch of line where it is strongest
//                       against what faces it, some periods and not others
//   about even          it holds
//   much the weaker     it digs in
//
// THE STORY STILL COMMANDS. An order the story gave a side stands, and its
// staff leaves the side alone, for STAFF_STORY_ORDER_DAYS; only an order that
// old, or none at all, is the staff's to replace. A side with a person on it
// has no staff: its own troops are that person's, and its allies' are ordered
// by the story (what they agreed in their talks).
//
// What the staff decides is an ordinary standing order, marked as its own
// (`mark: "staff"`), so the brief and the war room show it like any other and
// the next period's story is told it.
//
// Only + - * / and whole-number steps from here down: the same input gives
// the same decision on every machine.

import {
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  STAFF_ATTACKER_ADVANCES,
  STAFF_ATTACKER_PROBES,
  STAFF_CHANCE_ATTACKER,
  STAFF_CHANCE_DEFENDER,
  STAFF_DEFENDER_ADVANCES,
  STAFF_DEFENDER_PROBES,
  STAFF_DIGS_IN_UNDER,
  SCENARIO_MARK,
  STAFF_MARK,
  STAFF_SECTOR_TROOPS_LEAST,
  STAFF_STORY_ORDER_DAYS,
  TROOP_ATTACK,
} from "./constants.js";
import { inSector, resolveSector } from "./sectors.js";
import { isLive } from "./troops.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// A number from 0 up to 1 that belongs to one decision.
const chanceOf = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
};

// What a side's troops are worth where `within(troop)` says, as the fight weighs them.
// What one troop is worth in attack, as the fight weighs it: its strength,
// kind and supply, and what the day makes of it (dawn.js). Before its side's
// quality and edge, which are the same for all of a side's troops.
export const troopWorth = (troop) => troop.strength * TROOP_ATTACK[troop.kind] * troop.supply * troop.punch;

const worthOf = (battle, side, within = null) => {
  let worth = 0;
  let count = 0;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || (within && !within(troop))) continue;
    worth += troopWorth(troop);
    count += 1;
  }
  return { worth: worth * battle.quality[side] * battle.edge[side].power, count };
};

// Whether a side is one a person plays on.
export const sideIsPlayed = (battle, side, players) => {
  const played = new Set((Array.isArray(players) ? players : []).map(fold).filter(Boolean));
  return battle.sides[side].some((member, at) => !battle.gone[side].has(at) && played.has(fold(member)));
};

// What a side's staff would have it do now.
//   battle      the battle as it stands
//   side        which side
//   began       whether this side is the one that began the war
//   today       { line, sectors } of the day (day.js prepare)
//   key         what makes this decision its own (seed, battlefield, side, date)
// Returns { order, sector } or null to leave the side as it is.
export const staffDecision = (battle, side, { began = false, today = null, key = "" } = {}) => {
  const own = worthOf(battle, side);
  const theirs = worthOf(battle, 1 - side);
  if (own.count === 0) return null;
  const ratio = theirs.worth > 0 ? own.worth / theirs.worth : 99;
  const advances = began ? STAFF_ATTACKER_ADVANCES : STAFF_DEFENDER_ADVANCES;
  const probes = began ? STAFF_ATTACKER_PROBES : STAFF_DEFENDER_PROBES;
  if (ratio >= advances) return { order: "advance", sector: "all", ratio };
  if (ratio < STAFF_DIGS_IN_UNDER) return { order: "dig in", sector: "all", ratio };
  if (ratio < probes) return { order: "hold", sector: "all", ratio };
  // Strong enough to try something, not to try everything: some periods it does.
  if (chanceOf(`${key}|tries`) >= (began ? STAFF_CHANCE_ATTACKER : STAFF_CHANCE_DEFENDER)) return { order: "hold", sector: "all", ratio };
  // Where along the line it is strongest against what faces it.
  let best = null;
  const names = today?.sectors?.names ?? [];
  for (const name of names) {
    const sector = today ? resolveSector(battle.arena, today.line, today.sectors, name) : null;
    if (!sector || sector.kind === "all") continue;
    const inside = (troop) => inSector(sector, troop.x, troop.y, battle.place.kmAt);
    const mine = worthOf(battle, side, inside);
    if (mine.count < STAFF_SECTOR_TROOPS_LEAST) continue;
    const facing = worthOf(battle, 1 - side, inside);
    const there = facing.worth > 0 ? mine.worth / facing.worth : 99;
    if (!best || there > best.there) best = { name, there };
  }
  // (A line too short to have stretches, or none where it has the edge: the whole of it, or nothing.)
  if (!best) return ratio >= 1 ? { order: "advance", sector: "all", ratio } : { order: "hold", sector: "all", ratio };
  if (best.there < 1) return { order: "hold", sector: "all", ratio };
  return { order: "advance", sector: best.name, ratio };
};

// Whether a side's standing orders are the staff's to replace: it has none
// for its line, or only its staff's own, or what the story gave it has stood
// longer than a story's order is left alone.
export const staffMayOrder = (battle, side) => {
  const standing = battle.orders.filter((order) => order.s === side && !order.chosen);
  // What its scenario's author made the front stands until an event changes it, however long that is.
  if (standing.some((order) => order.mark === SCENARIO_MARK)) return false;
  return standing.every((order) => order.mark === STAFF_MARK || (Number(order.age) || 0) > STAFF_STORY_ORDER_DAYS);
};

// What a side stands under now, as the staff would write it: "" for nothing.
export const staffStanding = (battle, side) => battle.orders
  .filter((order) => order.s === side && !order.chosen && order.mark === STAFF_MARK)
  .map((order) => `${order.order}|${fold(order.sector)}`)
  .sort()
  .join(";");

export const STAFF_SIDES = Object.freeze([HOLDER_SIDE_A, HOLDER_SIDE_B]);
