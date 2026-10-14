/*! Open Historia — the weather as the map shows it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// How each weather is drawn, so it can be told at a glance: rain in slanting
// streaks, a storm in dense streaks under a darker wash, snow in flakes, a
// blizzard in driven flakes under a white veil, fog as a grey veil, mud as
// brown blotches, heat as a pale warm shimmer, frost as an icy speckle. Clear
// weather draws nothing. And the chip that says a season and a weather:
// "Winter · snow".
//
// The weather is drawn in the shapes of the climate zones a scenario's
// designer painted, one patch a zone (weatherPatches.js): "the weather patches
// should be drawn by scenario designers who can choose the climate regions"
// (the owner, 2026-10-14). A battlefield in no zone has no patch: only its
// chip says its weather (battleChipFeatures).
//
// Pure: features out of records. The layers are FrontWeatherLayers.jsx; the
// pictures mapPatterns.js.

import { WEATHER_STATES } from "../../runtime/fronts/weather.js";
import { normalizeFrame, projectorOf } from "../../runtime/fronts/frame.js";
import { weatherDrifts, weatherImageId } from "./mapPatterns.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const collection = (features) => ({ type: "FeatureCollection", features });
const round6 = (value) => Math.round(value * 1e6) / 1e6;

// What each weather is drawn with: whether it has a picture (mapPatterns.js),
// the flat wash of colour laid under it, and the word its chip says.
export const WEATHER_OVERLAYS = Object.freeze({
  clear: Object.freeze({ chipLabel: "clear", pattern: false, wash: null }),
  rain: Object.freeze({ chipLabel: "rain", pattern: true, wash: null }),
  storm: Object.freeze({ chipLabel: "storm", pattern: true, wash: Object.freeze({ color: "#1b2532", opacity: 0.28 }) }),
  mud: Object.freeze({ chipLabel: "mud", pattern: true, wash: Object.freeze({ color: "#6b4a2a", opacity: 0.12 }) }),
  snow: Object.freeze({ chipLabel: "snow", pattern: true, wash: Object.freeze({ color: "#eef4fb", opacity: 0.1 }) }),
  blizzard: Object.freeze({ chipLabel: "blizzard", pattern: true, wash: Object.freeze({ color: "#f1f5fa", opacity: 0.36 }) }),
  frost: Object.freeze({ chipLabel: "frost", pattern: true, wash: Object.freeze({ color: "#d4e6f7", opacity: 0.1 }) }),
  heat: Object.freeze({ chipLabel: "heat", pattern: true, wash: Object.freeze({ color: "#ffc070", opacity: 0.15 }) }),
  fog: Object.freeze({ chipLabel: "fog", pattern: true, wash: Object.freeze({ color: "#bfc5cc", opacity: 0.36 }) }),
});
// The world's own seasons, as a chip says them.
export const SEASON_CHIPS = Object.freeze({
  winter: Object.freeze({ chipLabel: "Winter" }),
  spring: Object.freeze({ chipLabel: "Spring" }),
  summer: Object.freeze({ chipLabel: "Summer" }),
  autumn: Object.freeze({ chipLabel: "Autumn" }),
});

// How a weather is drawn: { pattern (an image id, or null), wash ({ color,
// opacity }, or null), drifts }, or null for what is not weather.
export const weatherOverlayOf = (state) => {
  if (!WEATHER_STATES.includes(state) || !Object.hasOwn(WEATHER_OVERLAYS, state)) return null;
  const overlay = WEATHER_OVERLAYS[state];
  return { pattern: overlay.pattern ? weatherImageId(state) : null, wash: overlay.wash, drifts: overlay.pattern && weatherDrifts(state) };
};

// The battlefields to draw weather over, as the world keeps them: those being
// fought over whose brief says the day's weather.
//   [{ name, frame, season, now }]
export const weatherFrontsOf = (battlefields) => list(battlefields).map((record) => {
  if (!record || (record.status !== "active" && record.status !== "frozen")) return null;
  const weather = record.brief?.weather;
  const now = clean(weather?.now);
  const frame = normalizeFrame(record.frame);
  if (!frame || !WEATHER_STATES.includes(now)) return null;
  return { name: clean(record.name), frame, season: clean(weather?.season), now };
}).filter(Boolean);

// The season a chip says: a zone's season is told with the zone's name before
// it ("The North, Winter": weather.js skyOver), which the chip leaves off.
// { text, kind }: "interface" for one of the world's own seasons, a word the
// language packs carry; "content" for a designer's own name.
export const chipSeasonOf = (season, zoneNames = []) => {
  let text = clean(season);
  if (!text) return null;
  const names = list(zoneNames).map(clean).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (text.length > name.length + 2 && text.startsWith(`${name}, `)) {
      text = text.slice(name.length + 2).trim();
      break;
    }
  }
  const world = Object.hasOwn(SEASON_CHIPS, text.toLowerCase()) ? SEASON_CHIPS[text.toLowerCase()] : null;
  return world ? { text: world.chipLabel, kind: "interface" } : { text, kind: "content" };
};

// What a battlefield's chip says: "Winter · snow". `label(text, kind)` puts a
// word into the player's language (FrontWeatherLayers.jsx); left out, English.
export const weatherChipText = ({ season = "", now = "" } = {}, { zoneNames = [], label = (text) => text } = {}) => {
  const overlay = Object.hasOwn(WEATHER_OVERLAYS, now) ? WEATHER_OVERLAYS[now] : null;
  const said = chipSeasonOf(season, zoneNames);
  return [said ? label(said.text, said.kind) : "", overlay ? label(overlay.chipLabel, "interface") : ""].map(clean).filter(Boolean).join(" · ");
};

// Whether a battlefield is in one of the scenario's climate zones: its season
// is told with the zone's name before it ("The North, Winter": weather.js skyOver).
export const inZone = (season, zoneNames = []) => {
  const text = clean(season);
  return list(zoneNames).map(clean).filter(Boolean).some((name) => text.length > name.length + 2 && text.startsWith(`${name}, `));
};

// A chip over each battlefield in no zone, saying its season and weather (a
// battlefield in a zone fights in the zone's weather, and the zone's own chip
// says it: weatherPatches.js). Over the middle of the battlefield's frame,
// toward its top.
//   fronts      weatherFrontsOf(world.battlefields)
//   zoneNames   the names of the scenario's climate zones
//   label       (text, kind) -> the text in the player's language
export const battleChipFeatures = ({ fronts = [], zoneNames = [], label } = {}) => {
  const chips = [];
  for (const front of list(fronts)) {
    const frame = front?.frame ? normalizeFrame(front.frame) : null;
    if (!frame || !weatherOverlayOf(front?.now) || inZone(front.season, zoneNames)) continue;
    const chip = weatherChipText(front, { zoneNames, label });
    if (!chip) continue;
    const [lng, lat] = projectorOf(frame).toLngLat(frame.cols / 2, frame.rows * 0.7);
    chips.push({ type: "Feature", geometry: { type: "Point", coordinates: [round6(lng), round6(lat)] }, properties: { name: front.name, weather: front.now, chip } });
  }
  return collection(chips);
};
