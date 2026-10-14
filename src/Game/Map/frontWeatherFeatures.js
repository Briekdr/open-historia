/*! Open Historia — a battlefield's weather as the map shows it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The weather over each battlefield being fought over (runtime/fronts/
// weather.js: the brief's season and the day's weather as its last run left
// them), drawn so it can be told at a glance: rain in slanting streaks, a storm
// in dense streaks under a darker wash, snow in flakes, a blizzard in driven
// flakes under a white veil, fog as a grey veil, mud as brown blotches, heat as
// a pale warm shimmer, frost as an icy speckle. Clear weather draws nothing.
//
// It lies over the battlefield's frame as an oval, the weather full in its
// middle and thinner in two steps toward its rim, so it reads as a spell of
// weather and not as a box. Over it, a chip says the season and the weather:
// "Winter · snow".
//
// Pure: features out of records. The layers are FrontWeatherLayers.jsx; the
// pictures mapPatterns.js.

import { WEATHER_STATES } from "../../runtime/fronts/weather.js";
import { latToY, normalizeFrame, projectorOf, yToLat } from "../../runtime/fronts/frame.js";
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

// The steps the weather thins in toward its rim: [outer edge, inner edge,
// strength], each a share of the oval round the frame.
export const WEATHER_BANDS = Object.freeze([
  Object.freeze([1, 0.84, 0.3]),
  Object.freeze([0.84, 0.68, 0.6]),
  Object.freeze([0.68, 0, 1]),
]);
const OVAL_POINTS = 48;

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

// The oval round a frame on the map's own plane: its middle and its two half-widths.
const ovalOf = (frame) => {
  const { toLngLat } = projectorOf(frame);
  const [west, south] = toLngLat(0, 0);
  const [east, north] = toLngLat(frame.cols, frame.rows);
  const bottom = latToY(south);
  const top = latToY(north);
  return { x: (west + east) / 2, y: (bottom + top) / 2, across: (east - west) / 2, up: (top - bottom) / 2 };
};
// A closed ring round the oval at a share of its size, one way round or the other.
const ringOf = (oval, share, backwards = false) => {
  const ring = [];
  for (let step = 0; step < OVAL_POINTS; step += 1) {
    const turn = ((backwards ? -step : step) * 2 * Math.PI) / OVAL_POINTS;
    ring.push([round6(oval.x + oval.across * share * Math.cos(turn)), round6(yToLat(oval.y + oval.up * share * Math.sin(turn)))]);
  }
  ring.push([...ring[0]]);
  return ring;
};

//   fronts      weatherFrontsOf(world.battlefields)
//   zoneNames   the names of the scenario's climate zones
//   label       (text, kind) -> the text in the player's language
// Returns { areas, chips }: the weather's bands (polygons, each with its
// weather, its strength, and its picture and wash where it has them) and a
// chip a battlefield (points over the middle of the weather, with what it says).
export const frontWeatherFeatures = ({ fronts = [], zoneNames = [], label } = {}) => {
  const areas = [];
  const chips = [];
  for (const front of list(fronts)) {
    const overlay = weatherOverlayOf(front?.now);
    const frame = front?.frame ? normalizeFrame(front.frame) : null;
    if (!overlay || !frame) continue;
    const oval = ovalOf(frame);
    if (overlay.pattern || overlay.wash) {
      for (const [outer, inner, strength] of WEATHER_BANDS) {
        const rings = inner > 0 ? [ringOf(oval, outer), ringOf(oval, inner, true)] : [ringOf(oval, outer)];
        areas.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: rings },
          properties: {
            name: front.name,
            weather: front.now,
            strength,
            ...(overlay.pattern ? { pattern: overlay.pattern } : {}),
            ...(overlay.wash ? { wash: overlay.wash.color, washOpacity: overlay.wash.opacity } : {}),
          },
        });
      }
    }
    const chip = weatherChipText(front, { zoneNames, label });
    if (chip) {
      chips.push({
        type: "Feature",
        // Over the middle of the weather, toward the top of its fullest part.
        geometry: { type: "Point", coordinates: [round6(oval.x), round6(yToLat(oval.y + oval.up * WEATHER_BANDS[2][0]))] },
        properties: { name: front.name, weather: front.now, chip },
      });
    }
  }
  return { areas: collection(areas), chips: collection(chips) };
};

// The battlefields' weathers that move (mapPatterns.js WEATHER_DRIFT), each
// with the box of the map it is over: [{ state, west, south, east, north }].
export const driftingWeatherOf = (fronts) => list(fronts).map((front) => {
  const overlay = weatherOverlayOf(front?.now);
  const frame = front?.frame ? normalizeFrame(front.frame) : null;
  if (!overlay?.drifts || !frame) return null;
  const { toLngLat } = projectorOf(frame);
  const [west, south] = toLngLat(0, 0);
  const [east, north] = toLngLat(frame.cols, frame.rows);
  return { state: front.now, west, south, east, north };
}).filter(Boolean);
