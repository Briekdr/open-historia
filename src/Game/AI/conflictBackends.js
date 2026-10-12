/*! Open Historia — one request for the backends of every country a player comes into conflict with © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A country a person's own comes into conflict with is asked for what the war
// reads of it (runtime/statsBackend.js: its people, its economy, the balance of
// its budget, its debt). That used to be a whole sheet of statistics a country,
// one request each, two at a time. "Can't you merge both AI requests into
// one?" It is ONE request now, for every such country there is: it asks only
// for the four figures, of all of them at once, and since they are worked out
// together they are in one unit and to one scale.
//
// What is kept is the backend alone, on the country's sheet. The rest of a
// sheet (its government, its indices, a scenario's own values) is written when
// somebody opens that country's statistics, as it always was, from the backend
// that is already there.
//
// This module is the request's words and the reading of its answer; the asking
// and the writing are gameplay.js ensureConflictBackends. Pure, and loads in
// plain Node.

import { readStatsBackend } from "../../runtime/statsBackend.js";

// The most countries one such request asks of.
export const CONFLICT_BACKENDS_MOST = 8;
// The most countries whose backends are shown for the unit and the scale.
export const CONFLICT_BACKENDS_KNOWN_MOST = 6;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// The request.
//   date        the game's date
//   rules       the scenario's own rules of its world and era, or ""
//   player      the country the player leads
//   countries   [{ name, population? }]: who is asked of; `population` where the scenario's author gives it
//   known       [{ name, backend }]: countries whose backends are already kept
export const conflictBackendsRequest = ({ date = "", rules = "", player = "", countries = [], known = [] } = {}) => {
  const asked = list(countries).map((entry) => ({ name: clean(entry?.name), population: Number(entry?.population) })).filter((entry) => entry.name).slice(0, CONFLICT_BACKENDS_MOST);
  const systemPrompt = [
    "You are Open Historia's national-statistics estimator. For each polity you are given, estimate four figures the game's own arithmetic needs and no player sees:",
    "population: its people, as a plain count.",
    "gdp: the size of its economy in a year, in ONE unit that you use for every polity of this world (the unit of the polities already known, where some are shown).",
    "budgetBalance: its treasury's balance for the year as a percentage of that economy (a surplus above 0, a deficit below).",
    "publicDebt: what its treasury owes, as a percentage of that economy.",
    "Go by the era, the world as described, and each polity's size and place in it. They are estimates for the game date given, not modern figures unless the game is modern. A polity whose scenario gives its people is given that figure: keep it.",
    "",
    "Return exactly one JSON object and no markdown:",
    '{"countries":[{"country":"the exact name you were given","population":0,"gdp":0,"budgetBalance":0,"publicDebt":0}]}',
    "One entry for every polity asked of, in the order given, each under the exact name given.",
  ].join("\n");
  const shown = list(known).filter((entry) => clean(entry?.name) && entry?.backend).slice(0, CONFLICT_BACKENDS_KNOWN_MOST);
  const userMessage = [
    `Game date: ${clean(date) || "unknown"}`,
    clean(player) ? `The player leads ${clean(player)}.` : "",
    clean(rules) ? `ERA & WORLD RULES:\n${String(rules).trim().slice(0, 1800)}` : "",
    shown.length
      ? `ALREADY KNOWN (for the unit and the scale; do not return these):\n${shown.map((entry) => `- ${clean(entry.name)}: ${JSON.stringify(entry.backend)}`).join("\n")}`
      : "No polity's figures are known yet: choose one unit for gdp and use it for all of these.",
    `ESTIMATE THESE:\n${asked.map((entry) => `- ${entry.name}${entry.population >= 1 ? ` (its scenario gives its people as ${Math.round(entry.population)})` : ""}`).join("\n")}`,
  ].filter(Boolean).join("\n\n");
  return { systemPrompt, userMessage, asked: asked.map((entry) => entry.name) };
};

// The answer, as a backend for each country that was asked of and answered
// usably: [{ name, backend }], under the names that were asked. A country
// nobody asked of is left out, and so is one answered twice after the first.
export const readConflictBackends = (payload, asked) => {
  const wanted = new Map(list(asked).map((name) => [fold(name), clean(name)]));
  const read = [];
  const seen = new Set();
  for (const entry of list(payload?.countries)) {
    const key = fold(entry?.country ?? entry?.name);
    if (!wanted.has(key) || seen.has(key)) continue;
    const backend = readStatsBackend(entry);
    if (!backend) continue;
    seen.add(key);
    read.push({ name: wanted.get(key), backend });
  }
  return read;
};
