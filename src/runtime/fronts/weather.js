/*! Open Historia — battlefields and fronts: seasons and the day's weather © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "weather"). "Nothing in the war engine
// changes with the season: add in depth seasonal effects and weather
// conditions."
//
// Every battlefield has its CLIMATE, by how far from the equator the middle of
// its ground lies (polar, continental, arid, tropical), and every day its
// SEASON (by the month, the other way round south of the equator) and its
// WEATHER, drawn from what that season brings in that climate: snow and
// blizzards in a northern winter, the spring thaw and autumn rains that turn
// the ground to mud, summer heat in the desert, the monsoon in the tropics.
// Weather comes in SPELLS of a few days, the same for a battlefield whoever
// runs it and however the turns are cut: each is drawn from the campaign's own
// seed, the battlefield and the spell, nothing else.
//
// What the weather does (WEATHER), each morning (dawn.js) and evening:
//
//   pace     how far troops get: deep mud and blizzards stop an advance
//   attack   how hard they hit: fog and storms blunt an attack
//   wear     what a day of it adds to every troop's fatigue (fatigue.js)
//   rest     how much a day's rest freshens a troop in it
//   air      whether aircraft fly (air.js): storms, blizzards and fog ground them
//   cold     strength a day lost to cold, by a troop short of supply in it
//   heat     the same, to heat and thirst
//
// A scenario's designer may draw climate zones of their own over this
// (climate.js); where none reaches, this is the weather.
//
// Only + - * / and comparisons; dates through gameDates.js.

import { diffGameDays, parseGameDate } from "../gameDates.js";
import { hashSeed } from "../unitMotion.js";
import { climateAt, oddsAt, zoneWeatherOn, zonesToday } from "./climate.js";
import { cellAt } from "./ground.js";

export const WEATHER_STATES = Object.freeze(["clear", "rain", "storm", "mud", "snow", "blizzard", "frost", "heat", "fog"]);
export const SEASONS = Object.freeze(["winter", "spring", "summer", "autumn"]);
export const CLIMATES = Object.freeze(["polar", "continental", "arid", "tropical"]);

const effect = (pace, attack, wear, rest, air, cold, heat) => Object.freeze({ pace, attack, wear, rest, air, cold, heat });
export const WEATHER = Object.freeze({
  clear: effect(1, 1, 0, 1, 1, 0, 0),
  rain: effect(0.8, 0.95, 0.01, 0.9, 0.6, 0, 0),
  storm: effect(0.6, 0.85, 0.02, 0.8, 0, 0.1, 0),
  mud: effect(0.45, 0.85, 0.025, 0.85, 0.7, 0, 0),
  snow: effect(0.65, 0.9, 0.015, 0.85, 0.5, 0.3, 0),
  blizzard: effect(0.3, 0.7, 0.03, 0.6, 0, 1, 0),
  frost: effect(0.9, 0.95, 0.01, 0.8, 0.9, 0.6, 0),
  heat: effect(0.85, 0.9, 0.02, 0.8, 1, 0, 0.5),
  fog: effect(0.9, 0.8, 0, 1, 0, 0, 0),
});
// Strength a day that "cold" or "heat" of 1 takes from a troop wholly without supply.
export const WEATHER_LOSS = 1.2;

// What each season brings in each climate: the odds of each state, adding to 1.
const odds = (fields) => Object.freeze({ clear: 0, rain: 0, storm: 0, mud: 0, snow: 0, blizzard: 0, frost: 0, heat: 0, fog: 0, ...fields });
export const WEATHER_ODDS = Object.freeze({
  polar: Object.freeze({
    winter: odds({ blizzard: 0.3, snow: 0.3, frost: 0.35, clear: 0.05 }),
    spring: odds({ snow: 0.3, frost: 0.2, mud: 0.2, clear: 0.3 }),
    summer: odds({ clear: 0.5, rain: 0.25, fog: 0.25 }),
    autumn: odds({ snow: 0.3, rain: 0.3, frost: 0.2, clear: 0.2 }),
  }),
  continental: Object.freeze({
    winter: odds({ snow: 0.3, frost: 0.25, blizzard: 0.1, clear: 0.25, fog: 0.1 }),
    spring: odds({ mud: 0.3, rain: 0.25, clear: 0.35, fog: 0.1 }),
    summer: odds({ clear: 0.6, rain: 0.2, storm: 0.1, heat: 0.1 }),
    autumn: odds({ rain: 0.35, mud: 0.25, clear: 0.3, fog: 0.1 }),
  }),
  arid: Object.freeze({
    winter: odds({ clear: 0.7, rain: 0.2, fog: 0.1 }),
    spring: odds({ clear: 0.65, heat: 0.25, storm: 0.1 }),
    summer: odds({ heat: 0.6, clear: 0.4 }),
    autumn: odds({ clear: 0.7, heat: 0.2, rain: 0.1 }),
  }),
  tropical: Object.freeze({
    winter: odds({ clear: 0.6, heat: 0.3, fog: 0.1 }),
    spring: odds({ clear: 0.5, heat: 0.3, rain: 0.2 }),
    summer: odds({ rain: 0.45, storm: 0.25, mud: 0.15, clear: 0.15 }),
    autumn: odds({ rain: 0.4, storm: 0.2, mud: 0.15, clear: 0.25 }),
  }),
});

// How many days a spell of weather lasts.
export const SPELL_DAYS = 4;
// The day spells are counted from.
export const SPELL_EPOCH = "2000-01-01";

// A climate by latitude.
export const climateOf = (lat) => {
  const away = lat < 0 ? -lat : lat;
  return away >= 60 ? "polar" : away >= 40 ? "continental" : away >= 20 ? "arid" : "tropical";
};

// A season by month (1 to 12) and latitude: the other way round south of the equator.
export const seasonOf = (month, lat) => {
  const turned = lat < 0 ? ((month + 5) % 12) + 1 : month;
  return turned === 12 || turned <= 2 ? "winter" : turned <= 5 ? "spring" : turned <= 8 ? "summer" : "autumn";
};

// What a draw from 0 up to 1 comes to among a season's odds.
export const pickWeather = (table, draw) => {
  let sum = 0;
  for (const state of WEATHER_STATES) {
    sum += table[state] ?? 0;
    if (draw < sum) return state;
  }
  return "clear";
};

// The weather on a day at a place: { state, season, climate }. `place` names
// what is having it (a battlefield, a stretch of sea): the same place, seed
// and spell is the same weather. A date the calendar cannot read is fair.
// `odds`, where given, are what the season brings there instead of the world's own (climate.js).
export const weatherOn = ({ seed = "", place = "", lat = 45, date = "", odds = null } = {}) => {
  const climate = climateOf(lat);
  const parsed = parseGameDate(date);
  if (!parsed) return { state: "clear", season: "", climate };
  const season = seasonOf(parsed.month, lat);
  const days = diffGameDays(SPELL_EPOCH, date);
  const spell = Math.floor((Number.isFinite(days) ? days : 0) / SPELL_DAYS);
  const draw = (hashSeed(`${seed}|${place}|${spell}|weather`) % 10000) / 10000;
  return { state: pickWeather(odds ?? WEATHER_ODDS[climate][season], draw), season, climate };
};

// A battlefield's weather for a day of a run: where its ground's middle lies,
// read once a frame (battle.climateFor). Sets battle.sky = { state, season,
// climate, effects } and counts the day (battle.skies) for the story.
export const skyOver = (run, battle, day) => {
  if (battle.climateFor !== battle.place) {
    const [, lat] = battle.place.toLngLat(battle.field.cols / 2, battle.field.rows / 2);
    battle.climateLat = Math.round(lat * 100) / 100;
    battle.climateFor = battle.place;
  }
  const seed = String(run.input?.climateSeed ?? run.seed ?? "");
  const date = run.dateOf(day);
  // Where a scenario's own climate zones reach the battlefield (climate.js), they bring its weather and set
  // what each troop's own ground does today; at its middle, the odds of the day's weather and the season's name.
  const today = zonesToday(run, battle, date, battle.climateLat);
  battle.climateToday = today;
  const parsed = parseGameDate(date);
  const worldOdds = parsed ? WEATHER_ODDS[climateOf(battle.climateLat)][seasonOf(parsed.month, battle.climateLat)] : null;
  const middle = cellAt(battle.field, battle.field.cols / 2, battle.field.rows / 2);
  const there = today && worldOdds ? oddsAt(today, middle, worldOdds) : null;
  // In a zone (half or more of its weight at the middle) the weather is the zone's, one for the whole of it
  // (climate.js zoneWeatherOn); elsewhere the battlefield's own, from the odds where it lies.
  const sky = there?.zone
    ? zoneWeatherOn({ seed, zone: there.zone.zone, date })
    : weatherOn({ seed, place: battle.name, lat: battle.climateLat, date, odds: there ? there.odds : null });
  if (there?.zone) sky.season = `${there.zone.zone.name ? `${there.zone.zone.name}, ` : ""}${sky.season}`;
  const forced = run.steer?.weather;
  const state = typeof forced === "string" && WEATHER[forced] ? forced : sky.state;
  // (The zones' own say over whether aircraft fly, at its middle.)
  const local = today ? climateAt(today, middle) : null;
  battle.sky = { ...sky, state, effects: local && local.air !== 1 ? { ...WEATHER[state], air: WEATHER[state].air * local.air } : WEATHER[state] };
  if (!battle.skies) battle.skies = {};
  battle.skies[state] = (battle.skies[state] ?? 0) + 1;
  return battle.sky;
};

// What a day of weather takes from a troop's strength, by its supply (a troop cut off has none): the day's
// weather's cold and heat, and its own ground's where a scenario's climate zones say more (climate.js).
export const weatherLoss = (sky, troop) => {
  if (!sky) return 0;
  const harsh = sky.effects.cold + sky.effects.heat + (troop.climate ? troop.climate.cold + troop.climate.heat : 0);
  if (!(harsh > 0)) return 0;
  const short = troop.pocket ? 1 : 1 - troop.supply;
  return short > 0 ? harsh * WEATHER_LOSS * short : 0;
};
