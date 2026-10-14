/*! Open Historia — a country's military power, as the player is shown it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/militaryPower.test.js
//
// "All 4 of these backend stats (quality, technology, manpower share,
// weariness) should decide what the country's overall frontend military power
// is", and land, sea and air are "ANOTHER set of stats that affect the overall
// front end military strength".

import test from "node:test";
import assert from "node:assert/strict";

import { countryWeight } from "./countryWeight.js";
import { MANPOWER_SHARE } from "./fronts/constants.js";
import { fundingFactor, middleFundingPerHead } from "./militaryFunding.js";
import { MANPOWER_PERCENT, militaryPower, militaryProfile, peopleFor } from "./militaryPower.js";
import { militaryLookup } from "./militaryStats.js";

const sheet = (people, gdp, balance = 0) => ({ population: { total: people }, economy: { gdp, budgetBalance: balance, publicDebt: 40 } });
const world = (extra = {}) => ({
  countryStats: {
    Aland: sheet(40e6, 9e11),
    Borduria: sheet(90e6, 6e11, -6),
    Cisland: sheet(12e6, 3e11),
  },
  polityOverrides: {
    Dorland: { name: "Dorland", population: 7e6 },
    Esland: { name: "Esland" },
  },
  groups: { "The Watch": { name: "The Watch", population: 2000 } },
  ...extra,
});
const weight = (name, regions = 0) => {
  const w = world();
  const people = peopleFor(w, name);
  if (people > 0) return countryWeight({ population: people, regions, funding: fundingFactor(w.countryStats[name], middleFundingPerHead(w.countryStats)) });
  return countryWeight({ regions });
};
// A world with one country's own figures in it, as its author gives them.
const withFigures = (name, military, extra = {}) => {
  const base = world(extra);
  return { ...base, polityOverrides: { ...base.polityOverrides, [name]: { ...(base.polityOverrides[name] ?? { name }), military } } };
};

test("at the figures every country has, the power is the land war's own weight to the last digit", () => {
  assert.equal(MANPOWER_PERCENT, Math.round(MANPOWER_SHARE * 100));
  assert.equal(MANPOWER_PERCENT, 12);
  for (const [name, regions] of [["Aland", 30], ["Borduria", 12], ["Cisland", 4], ["Dorland", 9], ["Esland", 5], ["Esland", 1], ["The Watch", 3]]) {
    assert.equal(militaryPower(world(), name, { regions }), weight(name, regions), `${name}, ${regions} regions`);
  }
  // Given figures that are every country's own are no different.
  const neutral = withFigures("Dorland", { quality: 50, technology: 50, land: 50, sea: 50, air: 50, weariness: 0, manpowerShare: 12 });
  assert.equal(militaryPower(neutral, "Dorland"), weight("Dorland"));
  // A scenario that switches mechanics off changes nothing at these figures.
  assert.equal(militaryPower(world({ warSettings: { mechanics: { military: false, air: false } } }), "Aland"), weight("Aland"));
  // Nothing known of it: no figure.
  assert.equal(militaryPower(world(), "Nowhere"), null);
  assert.equal(militaryPower(world(), "Esland"), null, "no people and no land given");
  assert.equal(militaryPower({}, ""), null);
});

test("quality, technology and the arms each move it, and an arm at 0 counts nothing", () => {
  const base = weight("Dorland");
  const power = (military, extra) => militaryPower(withFigures("Dorland", military, extra), "Dorland");
  assert.equal(power({ quality: 100 }), base * 1.5);
  assert.equal(power({ quality: 0 }), base * 0.5);
  assert.equal(power({ technology: 100 }), base * 1.3);
  assert.equal(power({ technology: 0 }), base * 0.7);
  // Land counts most, then the sea, then the air.
  assert.ok(Math.abs(power({ land: 100 }) - base * 1.3) < 1e-9);
  assert.ok(Math.abs(power({ sea: 100 }) - base * 1.125) < 1e-9);
  assert.ok(Math.abs(power({ air: 100 }) - base * 1.075) < 1e-9);
  // No navy (the Dothraki): the sea's quarter is gone, not halved.
  assert.ok(Math.abs(power({ sea: 0 }) - base * 0.75) < 1e-9);
  assert.ok(Math.abs(power({ sea: 1 }) - base * (0.75 + 0.25 * 0.51)) < 1e-9);
  assert.equal(power({ land: 0, sea: 0, air: 0 }), 0, "no army, no navy, no air force");
  // A scenario that leaves air out of its battles weighs the land and the sea alone.
  const noAir = { warSettings: { mechanics: { air: false } } };
  assert.equal(power({ air: 0 }, noAir), base);
  assert.ok(Math.abs(power({ land: 100 }, noAir) - base * ((0.6 * 1.5 + 0.25) / 0.85)) < 1e-9);
});

test("the share of people who can fight counts as more or fewer people; a weary country is worth less", () => {
  const base = weight("Dorland");
  // Four times the share is four times the people: twice the weight, by the root.
  assert.ok(Math.abs(militaryPower(withFigures("Dorland", { manpowerShare: 48 }), "Dorland") - countryWeight({ population: 28e6 })) < 1e-9);
  // The scenario's share for every country, unless a country has its own.
  const scenario = world({ warSettings: { manpowerShare: 3 } });
  assert.ok(Math.abs(militaryPower(scenario, "Dorland") - countryWeight({ population: 7e6 / 4 })) < 1e-9);
  // Where its land stands in for its people, by the root of the same ratio.
  const watchless = withFigures("Esland", { manpowerShare: 48 });
  assert.ok(Math.abs(militaryPower(watchless, "Esland", { regions: 4 }) - countryWeight({ regions: 4 }) * 2) < 1e-9);
  // Weariness costs nothing up to 50, then down to 0.6 at 100.
  assert.equal(militaryPower(world({ warWeariness: [{ country: "Dorland", value: 50 }] }), "Dorland"), base);
  assert.ok(Math.abs(militaryPower(world({ warWeariness: [{ country: "dorland", value: 75 }] }), "Dorland") - base * 0.8) < 1e-9);
  assert.ok(Math.abs(militaryPower(world({ warWeariness: [{ country: "Dorland", value: 100 }] }), "Dorland") - base * 0.6) < 1e-9);
  // The figure its author gave it to begin with, until the game keeps one of its own.
  const tired = withFigures("Dorland", { weariness: 100 });
  assert.ok(Math.abs(militaryPower(tired, "Dorland") - base * 0.6) < 1e-9);
  assert.equal(militaryPower({ ...tired, warWeariness: [{ country: "Dorland", value: 20 }] }, "Dorland"), base);
});

test("the profile says which figures are the country's own, and a scenario that does not count them shows none", () => {
  const night = world({ groups: { "The Watch": { name: "The Watch", population: 2000, military: { manpowerShare: 60, quality: 70 } } } });
  const lookup = militaryLookup(night);
  const profile = militaryProfile(night, "the watch", { regions: 3, lookup });
  assert.deepEqual(profile.figures, { quality: 70, technology: 50, land: 50, sea: 50, air: 50, manpowerShare: 60, weariness: 0 });
  assert.deepEqual(profile.own, { quality: true, technology: false, land: false, sea: false, air: false, manpowerShare: true, weariness: false });
  assert.equal(profile.counted, true);
  assert.ok(Math.abs(profile.power - countryWeight({ population: 2000 * 5 }) * 1.2) < 1e-9);
  // The sheet's figures stand over the author's.
  const sheeted = { ...night, countryStats: { ...night.countryStats, "The Watch": { military: { quality: 30 } } } };
  assert.equal(militaryProfile(sheeted, "The Watch").figures.quality, 30);
  // Turned off, every country is at every country's figures, the scenario's share of people aside.
  const off = { ...night, warSettings: { mechanics: { military: false }, manpowerShare: 24 } };
  const flat = militaryProfile(off, "The Watch");
  assert.equal(flat.counted, false);
  assert.deepEqual(flat.figures, { quality: 50, technology: 50, land: 50, sea: 50, air: 50, manpowerShare: 24, weariness: 0 });
  assert.equal(Object.values(flat.own).some(Boolean), false);
  // Funding is the land war's own (militaryFunding.js), read for the country it is asked for.
  assert.ok(militaryPower(world(), "Aland") > militaryPower(world(), "Cisland"));
});
