/*! Open Historia — the strategy network experiment: the arena © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. Wars for two staffs to fight each other in.
//
// "Train the AIs against each other and whichever wins advances. Add penalties
// for losing city territory, for losing troops, and for losing land; have the
// models train across various different country combos; add bonuses for taking
// enemy cities, encompassing, taking troops, and taking land."
//
// A SCENARIO is drawn from a seed: two to four countries side by side on a
// sheet, each of its own size and strength, with a capital and a few towns; a
// war between two TEAMS of them (one against one, two against one, one against
// two, two against two, or one against one with a neighbour looking on); an
// age, from galleys to the present; four to six months of it. The game's own
// front engine fights it a month at a time.
//
// Each team is led by a STAFF: a trained network, the engine's scripted staff,
// or a plain habit. The same staff leads every country and every battlefield
// of its team.
//
// WHAT A TEAM IS REWARDED AND CHARGED (REWARD below), each a share from 0 up:
//
//   land taken        the share of the other team's home ground it holds at the end
//   land lost         the share of its own the other team holds
//   cities taken      the cities it took, a capital counting three and a large
//                     town two, as a share of what the other team had
//   cities lost       the same, of its own
//   troops taken      the other team's losses in strength, against what it began with
//   troops lost       its own
//   encompassing      the largest share of the other team's troops it had cut
//                     off at once, and every pocket of them that gave up
//
// Losing counts for more than taking: "it should factor in needing to defend
// its own territory".
//
// Everything is drawn from the scenario's seed: the same scenario and the same
// two staffs are the same war.

import { addGameDays } from "../../src/runtime/gameDates.js";
import { runFronts } from "../../src/runtime/fronts/engine.js";
import { countGround, homeTableOf } from "../../src/runtime/fronts/mind/features.js";
import { syntheticMap } from "../../src/runtime/fronts/syntheticMap.js";

export const REWARD = Object.freeze({
  landTaken: 1,
  landLost: 1.5,
  cityTaken: 0.6,
  cityLost: 0.9,
  troopsTaken: 0.4,
  troopsLost: 0.5,
  encompassed: 0.5,
});
export const REWARD_PARTS = Object.freeze(["landTaken", "landLost", "cityTaken", "cityLost", "troopsTaken", "troopsLost", "encompassed"]);
// What a pocket that gave up adds to the share cut off, and the most any one share counts for.
export const POCKET_GAVE_UP = 0.25;
export const SHARE_MOST = 1.5;
export const PERIOD_DAYS = 30;
export const AGES = Object.freeze([1200, 1650, 1914, 1941, 1975, 2024]);
const COUNTRIES = Object.freeze(["Aland", "Borduria", "Cisland", "Dorland"]);
const LETTERS = "ABCD";
const LARGE_TOWN = 100000;

// A generator of numbers from 0 up to 1, from a seed (mulberry32).
export const rngOf = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

// Who is at war with whom, by how many countries there are: [team that began, the other], and a word for it.
const COMBOS = Object.freeze({
  2: [{ teams: [[0], [1]], kind: "one against one" }],
  3: [
    { teams: [[0, 2], [1]], kind: "two against one" },
    { teams: [[1], [0, 2]], kind: "one against two" },
    { teams: [[0], [1]], kind: "one against one, a neighbour looking on" },
    { teams: [[1], [2]], kind: "one against one, a neighbour looking on" },
  ],
  4: [
    { teams: [[0, 2], [1, 3]], kind: "two against two" },
    { teams: [[0, 1], [2, 3]], kind: "two against two" },
    { teams: [[1], [0, 2]], kind: "one against two" },
    { teams: [[1, 3], [2]], kind: "two against one" },
  ],
});

// A war to be fought, from a seed.
export const makeScenario = (seed) => {
  const random = rngOf(seed);
  const pick = (least, most) => least + Math.floor(random() * (most - least + 1));
  const count = [2, 2, 2, 3, 3, 3, 4, 4][pick(0, 7)];
  const rows = pick(3, 6);
  const widths = Array.from({ length: count }, () => pick(2, 4));
  const cols = widths.reduce((sum, width) => sum + width, 0);
  // Where each country's band ends, row by row: the borders wander a little.
  const ends = [];
  let at = 0;
  for (const width of widths.slice(0, -1)) {
    at += width;
    ends.push(at);
  }
  const layout = [];
  const edges = ends.slice();
  for (let row = 0; row < rows; row += 1) {
    for (let index = 0; index < edges.length; index += 1) {
      const least = (index === 0 ? 0 : edges[index - 1]) + 1;
      const most = (index === edges.length - 1 ? cols : edges[index + 1]) - 1;
      edges[index] = Math.max(least, Math.min(most, edges[index] + pick(-1, 1)));
    }
    let line = "";
    for (let col = 0; col < cols; col += 1) line += LETTERS[edges.findIndex((edge) => col < edge) < 0 ? count - 1 : edges.findIndex((edge) => col < edge)];
    layout.push(line);
  }
  const step = [0.5, 0.75, 1][pick(0, 2)];
  const stepLat = Math.round(step * 0.6 * 100) / 100;
  // What each country is: a small state, a middling one or a great power.
  const weights = Array.from({ length: count }, () => {
    const [least, most] = [[1.5, 3], [3, 6], [6, 9]][pick(0, 2)];
    return Math.round((least + random() * (most - least)) * 10) / 10;
  });
  const combo = COMBOS[count][pick(0, COMBOS[count].length - 1)];
  // A capital and up to three towns each, on regions of its own.
  const cities = [];
  for (let country = 0; country < count; country += 1) {
    const cells = [];
    layout.forEach((line, row) => [...line].forEach((letter, col) => { if (letter === LETTERS[country]) cells.push([col, row]); }));
    const towns = Math.min(cells.length, 1 + pick(0, 3));
    for (let town = 0; town < towns; town += 1) {
      const [col, row] = cells.splice(pick(0, cells.length - 1), 1)[0];
      cities.push({
        name: town === 0 ? `${COUNTRIES[country]} Capital` : `${COUNTRIES[country]} Town ${town}`,
        lng: 20 + (col + 0.5) * step,
        lat: 52 - (row + 0.5) * stepLat,
        population: town === 0 ? 500000 + pick(0, 4500000) : 20000 + pick(0, 780000),
        ...(town === 0 ? { capital: true } : {}),
        country,
      });
    }
  }
  return {
    seed,
    layout,
    step,
    stepLat,
    countries: COUNTRIES.slice(0, count),
    weights,
    teams: combo.teams,
    kind: combo.kind,
    cities,
    year: AGES[pick(0, AGES.length - 1)],
    periods: pick(4, 6),
  };
};

// The plain habits a staff is tried against beside the scripted one.
export const HABITS = Object.freeze({
  advance: () => ({ order: "advance", sector: "all" }),
  hold: () => ({ order: "hold", sector: "all" }),
  dig: () => ({ order: "dig in", sector: "all" }),
});

const fold = (value) => String(value ?? "").trim().toLowerCase();
const capped = (value) => Math.max(0, Math.min(SHARE_MOST, value));
// A country's people from its weight: what countryWeight reads back (2 * sqrt(millions)).
const peopleOfWeight = (weight) => Math.round(((weight / 2) * (weight / 2)) * 1e6);
const cityWorth = (city) => (city.capital ? 3 : (Number(city.population) || 0) >= LARGE_TOWN ? 2 : 1);

// Fights a scenario between two staffs.
//   staffs   [the staff of the team that began the war, the other team's]: each a
//            (battle, side, context, run) => decision | undefined, or null for the
//            engine's own scripted staff
// Returns { rewards: [a, b], parts: [{ landTaken, ... }, { ... }], looks: [n, n], said: [[4 counts], [4 counts]] }.
export const fight = (scenario, staffs = [null, null]) => {
  const legend = Object.fromEntries(scenario.countries.map((name, index) => [LETTERS[index], name]));
  const world = syntheticMap({ layout: scenario.layout, legend, west: 20, north: 52, step: scenario.step, stepLat: scenario.stepLat, cities: scenario.cities.map(({ country, ...city }) => city), key: `arena-${scenario.seed}` });
  const names = scenario.countries;
  const teamOfName = new Map();
  scenario.teams.forEach((members, team) => members.forEach((index) => teamOfName.set(fold(names[index]), team)));
  const teamOf = (name) => teamOfName.get(fold(name)) ?? -1;
  const people = new Map(names.map((name, index) => [fold(name), peopleOfWeight(scenario.weights[index])]));
  const weights = new Map(names.map((name, index) => [fold(name), scenario.weights[index]]));

  const looks = [0, 0];
  const said = [[0, 0, 0, 0], [0, 0, 0, 0]];
  // What is known of each battlefield: whose home each cell is, which team each of its sides is, and the tallies.
  const fields = new Map();
  const fieldOf = (name) => {
    if (!fields.has(name)) fields.set(name, { homes: null, teams: [-1, -1], ground: null, before: [new Map(), new Map()], began: [0, 0], lost: [0, 0], cut: [0, 0], run: -1 });
    return fields.get(name);
  };
  let period = 0;
  const staffPolicy = (battle, side, context, run) => {
    const field = fieldOf(battle.name);
    field.homes = homeTableOf(battle, run);
    field.teams = [teamOf(battle.sides[0][0]), teamOf(battle.sides[1][0])];
    const team = field.teams[side];
    if (team < 0) return undefined;
    looks[team] += 1;
    const staff = staffs[team];
    if (!staff) return undefined;
    const decided = staff(battle, side, context, run);
    if (decided && Number.isInteger(decided.action)) said[team][decided.action] += 1;
    return decided;
  };
  // Every day of every battlefield: who holds what, what each side's troops lost, and how many are cut off.
  const watch = (seen) => {
    const field = fieldOf(seen.battlefield);
    if (field.homes && seen.holders && field.homes.length === seen.holders.length) field.ground = [countGround(seen.holders, field.homes, 0), countGround(seen.holders, field.homes, 1)];
    for (const side of [0, 1]) {
      const troops = seen.troops?.[side] ?? [];
      // (A month's troops are read afresh from the record: what they were the month before is not theirs to lose again.)
      if (field.run !== period) field.before[side] = new Map();
      let live = 0;
      let cut = 0;
      let total = 0;
      troops.forEach((troop, index) => {
        const strength = Math.max(0, Number(troop.strength) || 0);
        const was = field.before[side].get(index);
        if (was !== undefined && strength < was) field.lost[side] += was - strength;
        field.before[side].set(index, strength);
        total += strength;
        if (strength > 0) {
          live += 1;
          if (troop.pocket) cut += 1;
        }
      });
      if (field.began[side] === 0) field.began[side] = total;
      if (live > 0 && cut / live > field.cut[side]) field.cut[side] = cut / live;
    }
    field.run = period;
  };

  const arenas = new Map();
  const cityTaken = [0, 0];
  const gaveUp = [0, 0];
  let saved = [];
  let fromDate = `${String(scenario.year).padStart(4, "0")}-03-01`;
  for (period = 0; period < scenario.periods; period += 1) {
    const toDate = addGameDays(fromDate, PERIOD_DAYS);
    const result = runFronts({
      battlefields: saved,
      fromDate,
      toDate,
      days: PERIOD_DAYS,
      moments: [],
      wars: [{ id: "war-1", title: "the war", status: "active", sideA: scenario.teams[0].map((index) => names[index]), sideB: scenario.teams[1].map((index) => names[index]) }],
      controllerOf: world.controllerOf,
      sovereignOf: world.sovereignOf,
      groupAreas: {},
      isGroup: () => false,
      units: [],
      map: world.map,
      regionTypes: [],
      strengthOf: (name) => weights.get(fold(name)) ?? 1,
      peopleOf: (name) => people.get(fold(name)) ?? 0,
      players: [],
      pace: 1,
      flipAllowance: null,
      seed: `arena|${scenario.seed}`,
      arenas,
      staffPolicy,
      watch,
    });
    for (const flip of result.flips ?? []) if (flip.kind === "control") world.controller.set(flip.regionId, flip.to);
    for (const entry of result.news ?? []) {
      const field = fields.get(entry.battlefield);
      if (!field || (entry.s !== 0 && entry.s !== 1)) continue;
      // A town taken is its taker's; troops cut off that gave up are the other side's doing.
      if (entry.k === "city") {
        const team = field.teams[entry.s];
        const city = scenario.cities.find((candidate) => `city: ${candidate.name}` === entry.at);
        if (team >= 0 && city) cityTaken[team] += cityWorth(city);
      } else if (entry.k === "pocket") {
        const team = field.teams[1 - entry.s];
        if (team >= 0) gaveUp[team] += 1;
      }
    }
    saved = result.battlefields ?? [];
    fromDate = toDate;
  }

  // The tallies, team by team.
  const home = [0, 0];
  const held = [0, 0];
  const began = [0, 0];
  const lost = [0, 0];
  const cut = [0, 0];
  for (const field of fields.values()) {
    for (const side of [0, 1]) {
      const team = field.teams[side];
      if (team < 0) continue;
      began[team] += field.began[side];
      lost[team] += field.lost[side];
      // (The largest share of a team's troops cut off at once, on any of its battlefields.)
      if (field.cut[side] > cut[team]) cut[team] = field.cut[side];
      if (field.ground) {
        home[team] += 1;
        held[team] += field.ground[side].lost;
      }
    }
  }
  const cityValue = [0, 0];
  for (const city of scenario.cities) {
    const team = teamOf(names[city.country]);
    if (team >= 0) cityValue[team] += cityWorth(city);
  }
  const parts = [0, 1].map((team) => {
    const other = 1 - team;
    return {
      landTaken: capped(home[other] > 0 ? held[other] / home[other] : 0),
      landLost: capped(home[team] > 0 ? held[team] / home[team] : 0),
      cityTaken: capped(cityValue[other] > 0 ? cityTaken[team] / cityValue[other] : 0),
      cityLost: capped(cityValue[team] > 0 ? cityTaken[other] / cityValue[team] : 0),
      troopsTaken: capped(began[other] > 0 ? lost[other] / began[other] : 0),
      troopsLost: capped(began[team] > 0 ? lost[team] / began[team] : 0),
      encompassed: capped(cut[other] + POCKET_GAVE_UP * gaveUp[team]),
    };
  });
  const rewards = parts.map((part) => REWARD.landTaken * part.landTaken - REWARD.landLost * part.landLost
    + REWARD.cityTaken * part.cityTaken - REWARD.cityLost * part.cityLost
    + REWARD.troopsTaken * part.troopsTaken - REWARD.troopsLost * part.troopsLost
    + REWARD.encompassed * part.encompassed);
  return { rewards, parts, looks, said };
};

// Two staffs against each other in one scenario, each leading each team once:
// how much better the first did than the second, over the two wars.
//   Returns { margin, first: [reward as the team that began, reward as the other], second: [...], parts, said }
//   parts and said are the first staff's, summed over its two wars.
export const match = (scenario, first, second) => {
  const opening = fight(scenario, [first, second]);
  const reply = fight(scenario, [second, first]);
  const mine = [opening.rewards[0], reply.rewards[1]];
  const theirs = [reply.rewards[0], opening.rewards[1]];
  const parts = Object.fromEntries(REWARD_PARTS.map((key) => [key, opening.parts[0][key] + reply.parts[1][key]]));
  const said = opening.said[0].map((count, at) => count + reply.said[1][at]);
  return { margin: mine[0] + mine[1] - theirs[0] - theirs[1], first: mine, second: theirs, parts, said };
};
