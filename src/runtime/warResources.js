/*! Open Historia — a country's war resources © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "supply"). "Make it so advancing uses up
// resources (so does building fortifications) which lowers the amount of
// resources availible weakening your army" (the owner, 2026-10-14).
//
// A country's WAR RESOURCES are what it fights with besides its men: fuel,
// shells, fodder, pay. The game keeps them as a share of what the country can
// hold, 0 to 100 (world.warResources; a country not in it has them all). No
// model is asked for them. They are SPENT by
//
//   advancing   every day its formations take ground or attack (fronts/dawn.js
//               dusk counts them): a period in which every one of them did,
//               every day it was at war, spends RESOURCES_ADVANCE_A_MONTH a
//               month; one in which half of them did, half that. Holding,
//               digging in and resting spend nothing.
//   building    every fortified line of its being built (warGeography.js
//               building): RESOURCES_FORTIFY_A_DAY for every day until it
//               stands. A longer or stronger line takes longer to build and so
//               costs more; a richer country builds it sooner and so for less
//               (fortifyCost.js).
//
// and REFILLED by its funding (militaryFunding.js fundingFactor): at the
// funding of an ordinary country, RESOURCES_REFILL_A_MONTH a month; a rich one
// more, a poor one less; in peace as at war, up to the full.
//
// WHAT THEY DO. Under RESOURCES_SHORT_FROM a country's armies are short, as a
// blockade leaves them (fronts/handicap.js shortEdge: they come back up to
// strength more slowly, with fewer reserves, and fight and move a little
// worse), the more so the lower, RESOURCES_SHORTAGE_MOST with nothing left;
// and its military power is less (militaryPower.js). So a country that
// attacks everywhere, all the time, runs itself dry within a couple of months,
// and one that holds where it can refills.
//
// Pure, and loads in plain Node.

import { addGameDays, diffGameDays } from "./gameDates.js";

export const RESOURCES_FULL = 100;
export const RESOURCES_ADVANCE_A_MONTH = 60;
export const RESOURCES_FORTIFY_A_DAY = 0.2;
export const RESOURCES_REFILL_A_MONTH = 15;
// From where running low tells on a country's armies, and what it is at its worst.
export const RESOURCES_SHORT_FROM = 40;
export const RESOURCES_SHORTAGE_MOST = 0.6;
export const RESOURCES_KEPT_MOST = 120;

const clean = (value, most = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const within = (value, least, most) => Math.min(most, Math.max(least, value));
const figure = (value) => {
  const read = Number(value);
  return Number.isFinite(read) ? read : 0;
};

// world.warResources: [{ country, value }], a country once, none at the full.
export const normalizeWarResources = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const country = clean(raw?.country);
    const read = Number(raw?.value);
    if (!country || !Number.isFinite(read) || kept.has(fold(country))) continue;
    const held = Math.round(within(read, 0, RESOURCES_FULL) * 10) / 10;
    if (held < RESOURCES_FULL) kept.set(fold(country), { country, value: held });
  }
  return [...kept.values()].slice(0, RESOURCES_KEPT_MOST);
};

// What a country has left, 0 to 100.
export const resourcesOf = (resources, country) => {
  const wanted = fold(country);
  const found = list(resources).find((entry) => fold(entry?.country) === wanted);
  const read = Number(found?.value);
  return Number.isFinite(read) ? within(read, 0, RESOURCES_FULL) : RESOURCES_FULL;
};

// How short running low leaves a country's armies, 0 to RESOURCES_SHORTAGE_MOST: nothing from RESOURCES_SHORT_FROM up.
export const resourceShortage = (value) => {
  const left = within(figure(value), 0, RESOURCES_FULL);
  if (left >= RESOURCES_SHORT_FROM) return 0;
  return (RESOURCES_SHORTAGE_MOST * (RESOURCES_SHORT_FROM - left)) / RESOURCES_SHORT_FROM;
};

// How many days of a period each line was being built: the days of
// [since, since + days) that fall in [from, to).
export const buildingDaysIn = (line, from, to) => {
  const since = clean(line?.building?.since, 40);
  const days = figure(line?.building?.days);
  if (!since || !(days > 0)) return 0;
  const start = diffGameDays(from, since);
  const span = diffGameDays(from, to);
  if (!Number.isFinite(start) || !Number.isFinite(span)) return 0;
  const first = Math.max(0, start);
  const last = Math.min(span, start + days);
  return last > first ? last - first : 0;
};

// A country's resources after a period.
//   before       what it had as the period began
//   days         how long the period was
//   advanced     the share of its formations' days at war spent advancing, 0 to 1
//   warDays      the days of the period it had formations at war
//   fortifying   days of building, summed over its lines being built
//   funding      its funding factor (militaryFunding.js): 1 an ordinary country's
export const resourcesAfter = ({ before = RESOURCES_FULL, days = 0, advanced = 0, warDays = 0, fortifying = 0, funding = 1 } = {}) => {
  const had = within(figure(before), 0, RESOURCES_FULL);
  const refill = (RESOURCES_REFILL_A_MONTH * Math.max(0, figure(funding)) * Math.max(0, figure(days))) / 30;
  const spent = (RESOURCES_ADVANCE_A_MONTH * within(figure(advanced), 0, 1) * Math.max(0, figure(warDays))) / 30
    + RESOURCES_FORTIFY_A_DAY * Math.max(0, figure(fortifying));
  return within(had + refill - spent, 0, RESOURCES_FULL);
};

// The world's war resources after a turn.
//   kept             world.warResources as the turn began
//   days             how long the turn's period was
//   toDate           the date it ended on
//   effort           what the land war's formations did: [{ name, advanced, troopDays, warDays }]
//                    (formation-days advancing, formation-days at war, days at war: fronts/dawn.js)
//   fortifications   world.fortifications as the turn ends
//   fundingOf        (name) => its funding factor; 1 where it is not given
export const withTurnResources = (kept, { days = 0, toDate = "", effort = [], fortifications = [], fundingOf = null } = {}) => {
  const before = normalizeWarResources(kept);
  const names = new Map(before.map((entry) => [fold(entry.country), entry.country]));
  const effortOf = new Map();
  for (const entry of list(effort)) {
    const key = fold(entry?.name);
    if (!key) continue;
    if (!names.has(key)) names.set(key, clean(entry.name));
    effortOf.set(key, entry);
  }
  const span = Math.max(0, Math.round(figure(days)));
  const from = toDate ? addGameDays(toDate, -span) : "";
  const building = new Map();
  if (from && toDate) {
    for (const line of list(fortifications)) {
      const owner = clean(line?.owner);
      const inPeriod = owner ? buildingDaysIn(line, from, toDate) : 0;
      if (!(inPeriod > 0)) continue;
      if (!names.has(fold(owner))) names.set(fold(owner), owner);
      building.set(fold(owner), (building.get(fold(owner)) ?? 0) + inPeriod);
    }
  }
  const next = [];
  for (const [key, country] of names) {
    const done = effortOf.get(key);
    const troopDays = figure(done?.troopDays);
    const value = resourcesAfter({
      before: resourcesOf(before, country),
      days: span,
      advanced: troopDays > 0 ? figure(done?.advanced) / troopDays : 0,
      warDays: figure(done?.warDays),
      fortifying: building.get(key) ?? 0,
      funding: typeof fundingOf === "function" && Number.isFinite(Number(fundingOf(country))) ? Number(fundingOf(country)) : 1,
    });
    if (value < RESOURCES_FULL) next.push({ country, value });
  }
  return normalizeWarResources(next);
};

// What building a line costs a country, as it is ordered: per month and in all, in points of its resources.
export const fortifyResourceCost = (buildDays) => {
  const days = Math.max(0, figure(buildDays));
  return { aMonth: Math.round(RESOURCES_FORTIFY_A_DAY * 30 * 10) / 10, total: Math.round(RESOURCES_FORTIFY_A_DAY * days) };
};
