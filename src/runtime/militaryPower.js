/*! Open Historia — a country's military power, as the player is shown it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2. "All 4 of these backend stats (quality, technology,
// manpower share, weariness) should decide what the country's overall
// frontend military power is", and its land, sea and air capabilities are
// "ANOTHER set of stats that affect the overall front end military strength".
//
// A country's MILITARY POWER, the figure the Stats pane shows on its Military
// card and ranks countries by (Game/GameUI/countryRanking.js), is its weight in
// a land war (countryWeight.js: its people, or the land it holds where nobody
// knows its people, and what its economy pays for), taken through its own
// military figures (militaryStats.js; what each does in a war:
// fronts/military.js):
//
//   manpower share  its people are counted at the share of them who can fight
//                   against the twelve in a hundred every country had, so a
//                   country of the usual share weighs what it always did. Where
//                   the land it holds stands in for its people, by the root of
//                   the same ratio, the way its people are counted.
//   quality         0.5 to 1.5, and technology 0.7 to 1.3, as its troops fight
//                   (statFactor: 1 at 50)
//   weariness       nothing up to 50; past it, less and less, to 0.6 at 100: a
//                   weary country fights less willingly. The game's own figure
//                   for it (warWeariness.js), else the one its author gave it to
//                   begin with.
//   arms            its land, sea and air arms, each 0.5 to 1.5 (1 at 50; an
//                   arm at 0 counts nothing), weighed 0.6, 0.25 and 0.15
//
// At the figures every country has (50 each, a share of twelve, no weariness)
// it is the weight to the last digit, so a game whose scenario gives nobody any
// figures ranks its countries exactly as it did. A scenario that turns
// countries' figures off (warSettings.js mechanics.military) leaves every
// country at those, its own share of people aside, which the engine counts
// either way; one that leaves air out of its battles (mechanics.air) weighs
// the land and the sea alone.
//
// Pure, and loads in plain Node.

import { countryWeight } from "./countryWeight.js";
import { MANPOWER_SHARE } from "./fronts/constants.js";
import { ARM_FACTORS, QUALITY_FACTORS, TECHNOLOGY_FACTORS, readMilitary, statFactor } from "./fronts/military.js";
import { fundingFactor, middleFundingPerHead } from "./militaryFunding.js";
import { militaryLookup } from "./militaryStats.js";
import { populationFigureOf } from "./populationFigure.js";
import { warSettingsOf } from "./warSettings.js";

// The share of its people every country could put under arms before, in percent.
export const MANPOWER_PERCENT = Math.round(MANPOWER_SHARE * 1000) / 10;
export const ARM_WEIGHTS = Object.freeze({ land: 0.6, sea: 0.25, air: 0.15 });
// Weariness costs nothing up to WEARY_POWER_FROM, and WEARY_POWER_COST_MOST at 100.
export const WEARY_POWER_FROM = 50;
export const WEARY_POWER_COST_MOST = 0.4;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const within = (value, least, most) => Math.min(most, Math.max(least, value));

// A record of a keyed map, by its key, else by its key or its name in any case.
const recordIn = (map, name) => {
  if (!isRecord(map) || !clean(name)) return null;
  if (isRecord(map[clean(name)])) return map[clean(name)];
  const key = fold(name);
  for (const [other, record] of Object.entries(map)) {
    if (isRecord(record) && (fold(other) === key || fold(record.name) === key)) return record;
  }
  return null;
};

// A country's people as the game knows them: its sheet's, else what the
// scenario's author gave it (or the group of that name). 0 where nobody says.
export const peopleFor = (world, name) => {
  const total = Number(recordIn(world?.countryStats, name)?.population?.total);
  if (Number.isFinite(total) && total > 0) return total;
  return populationFigureOf(recordIn(world?.polityOverrides, name)) || populationFigureOf(recordIn(world?.groups, name));
};

// How weary of war a country is now, 0 to 100, and whose figure that is:
// "game" (world.warWeariness), "own" (what its author gave it to begin with),
// or "none".
const wearinessFor = (world, name, given) => {
  const key = fold(name);
  for (const entry of Array.isArray(world?.warWeariness) ? world.warWeariness : []) {
    const value = Number(entry?.value);
    if (key && fold(entry?.country) === key && Number.isFinite(value)) return { value: within(value, 0, 100), from: "game" };
  }
  const own = Number(given?.weariness);
  if (given?.weariness !== undefined && given?.weariness !== null && Number.isFinite(own)) return { value: within(own, 0, 100), from: "own" };
  return { value: 0, from: "none" };
};

// What an arm is worth to the power: nothing at 0.
const armFactor = (value) => (value <= 0 ? 0 : statFactor(value, ARM_FACTORS[0], ARM_FACTORS[1]));

// Everything a country's military power is read from, and the power.
//   regions   how many regions it holds (countryRanking.js regionCountsOf): its
//             size where nobody knows its people
//   middle    middleFundingPerHead of the world's sheets; worked out here when not given
//   lookup    militaryLookup(world), to read many countries of one world
// Returns {
//   power     the figure, or null where neither its people nor any land of it is known
//   base      its weight at its share of people, before its figures
//   figures   { quality, technology, land, sea, air, manpowerShare, weariness } as they count
//   own       for each figure, whether it is the country's own (its author's, its
//             sheet's, or for weariness the game's) rather than every country's
//   factors   { quality, technology, weariness, arms }
//   counted   whether the scenario counts countries' own figures at all
// }
export const militaryProfile = (world, name, { regions = 0, middle = null, lookup = null } = {}) => {
  const settings = warSettingsOf(world);
  const counted = settings.mechanics.military;
  const given = counted ? (typeof lookup === "function" ? lookup : militaryLookup(world))(name) : null;
  const read = readMilitary(given);
  const share = read.manpowerShare ?? settings.manpowerShare ?? MANPOWER_PERCENT;
  const weary = wearinessFor(world, name, given);
  const figures = {
    quality: read.quality,
    technology: read.technology,
    land: read.land,
    sea: read.sea,
    air: read.air,
    manpowerShare: share,
    weariness: weary.value,
  };
  const has = (key) => given?.[key] !== undefined && given?.[key] !== null;
  const own = {
    quality: has("quality"),
    technology: has("technology"),
    land: has("land"),
    sea: has("sea"),
    air: has("air"),
    manpowerShare: read.manpowerShare !== null,
    weariness: weary.from !== "none",
  };

  // (A ratio of exactly 1 at the usual share: the people are the people, and the root of 1 is 1.)
  const ratio = share / MANPOWER_PERCENT;
  const people = peopleFor(world, name);
  const land = Math.max(0, Number(regions) || 0);
  let base = null;
  if (people > 0) {
    const paid = fundingFactor(recordIn(world?.countryStats, name), middle ?? middleFundingPerHead(world?.countryStats));
    base = countryWeight({ population: people * ratio, regions: land, funding: paid });
  } else if (land > 0) {
    base = countryWeight({ regions: land }) * Math.sqrt(ratio);
  }

  const landArm = armFactor(figures.land);
  const seaArm = armFactor(figures.sea);
  const arms = settings.mechanics.air
    ? ARM_WEIGHTS.land * landArm + ARM_WEIGHTS.sea * seaArm + ARM_WEIGHTS.air * armFactor(figures.air)
    : (ARM_WEIGHTS.land * landArm + ARM_WEIGHTS.sea * seaArm) / (ARM_WEIGHTS.land + ARM_WEIGHTS.sea);
  const factors = {
    quality: statFactor(figures.quality, QUALITY_FACTORS[0], QUALITY_FACTORS[1]),
    technology: statFactor(figures.technology, TECHNOLOGY_FACTORS[0], TECHNOLOGY_FACTORS[1]),
    weariness: 1 - (WEARY_POWER_COST_MOST * Math.max(0, figures.weariness - WEARY_POWER_FROM)) / (100 - WEARY_POWER_FROM),
    arms,
  };
  const power = base === null ? null : base * factors.quality * factors.technology * factors.weariness * factors.arms;
  return { power, base, figures, own, factors, counted };
};

// A country's military power: null where neither its people nor any land of it is known.
export const militaryPower = (world, name, options = {}) => militaryProfile(world, name, options).power;
