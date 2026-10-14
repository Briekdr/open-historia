/*! Open Historia — a battlefield's weather as the map shows it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/frontWeatherFeatures.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WEATHER_STATES } from "../../runtime/fronts/weather.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import {
  SEASON_CHIPS,
  WEATHER_BANDS,
  WEATHER_OVERLAYS,
  chipSeasonOf,
  driftingWeatherOf,
  frontWeatherFeatures,
  weatherChipText,
  weatherFrontsOf,
  weatherOverlayOf,
} from "./frontWeatherFeatures.js";
import {
  CHIP_STRETCH,
  CHIP_TILE,
  ICE_TILE,
  WEATHER_DRIFT,
  WEATHER_DRAWN,
  WEATHER_TILE,
  chipPicture,
  iceHintPattern,
  icePattern,
  weatherDrifts,
  weatherImageId,
  weatherPattern,
} from "./mapPatterns.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8").split("\r\n").join("\n");

const frame = { lng0: 30, lat0: 48, cell: 0.1, cols: 60, rows: 40, km: 7 };
const battlefield = (extra = {}) => ({ name: "The Steppe", status: "active", sides: [["Aland"], ["Borea"]], frame, brief: { weather: { season: "winter", now: "snow", days: { snow: 6, clear: 2 } } }, ...extra });
const shown = (image) => {
  let count = 0;
  for (let at = 3; at < image.data.length; at += 4) if (image.data[at] > 0) count += 1;
  return count;
};
// A colour a person would call purple or violet: blue and red both well over green, blue at least red.
const purple = ([red, green, blue]) => blue >= red && red > green + 40 && blue > green + 60;

test("each weather is drawn its own way, and clear weather not at all", () => {
  for (const state of WEATHER_STATES) assert.ok(Object.hasOwn(WEATHER_OVERLAYS, state), `${state} has no look`);
  assert.deepEqual(weatherOverlayOf("clear"), { pattern: null, wash: null, drifts: false });
  assert.equal(weatherOverlayOf("hail"), null);
  assert.equal(weatherOverlayOf(""), null);
  // Rain is streaks alone; a storm is streaks under a darker wash.
  assert.deepEqual(weatherOverlayOf("rain"), { pattern: "oh-weather-rain", wash: null, drifts: true });
  const storm = weatherOverlayOf("storm");
  assert.equal(storm.pattern, "oh-weather-storm");
  assert.ok(parseInt(storm.wash.color.slice(1), 16) < 0x404040, "a darker wash");
  // Snow is flakes; a blizzard is flakes under a white veil, thicker than snow's.
  const snow = weatherOverlayOf("snow");
  const blizzard = weatherOverlayOf("blizzard");
  assert.ok(blizzard.wash.opacity > snow.wash.opacity && parseInt(blizzard.wash.color.slice(1, 3), 16) > 0xe0);
  // Fog is a grey veil; heat a pale warm one; mud and frost lie on the ground and keep still.
  const [fogRed, fogGreen, fogBlue] = [1, 3, 5].map((at) => parseInt(weatherOverlayOf("fog").wash.color.slice(at, at + 2), 16));
  assert.ok(Math.max(fogRed, fogGreen, fogBlue) - Math.min(fogRed, fogGreen, fogBlue) < 24 && weatherOverlayOf("fog").wash.opacity >= 0.3);
  const heat = weatherOverlayOf("heat").wash.color;
  assert.ok(parseInt(heat.slice(1, 3), 16) > parseInt(heat.slice(5, 7), 16), "warm");
  assert.equal(weatherOverlayOf("mud").drifts, false);
  assert.equal(weatherOverlayOf("frost").drifts, false);
  for (const state of ["rain", "storm", "snow", "blizzard", "fog", "heat"]) assert.equal(weatherOverlayOf(state).drifts, true, state);
});

test("the weather's pictures: flat tiles of their marks, denser for the worse weather, nothing for clear", () => {
  assert.equal(weatherPattern("clear"), null);
  assert.equal(weatherPattern("hail"), null);
  const counts = {};
  for (const state of WEATHER_DRAWN) {
    const image = weatherPattern(state);
    assert.deepEqual([image.width, image.height, image.data.length], [WEATHER_TILE, WEATHER_TILE, WEATHER_TILE * WEATHER_TILE * 4]);
    counts[state] = shown(image);
    assert.ok(counts[state] > 20 && counts[state] < WEATHER_TILE * WEATHER_TILE * 0.5, `${state}: ${counts[state]} pixels`);
    for (let at = 0; at < image.data.length; at += 4) {
      if (image.data[at + 3] === 0) continue;
      assert.equal(purple([image.data[at], image.data[at + 1], image.data[at + 2]]), false, `${state} has a purple pixel`);
    }
  }
  assert.ok(counts.storm > counts.rain * 1.5, "a storm's rain is denser");
  assert.ok(counts.blizzard > counts.snow, "a blizzard's snow is denser");
  // Rain leans: each streak's pixels run down and to the left.
  const rain = weatherPattern("rain");
  const at = (image, x, y) => image.data[(((y % WEATHER_TILE) + WEATHER_TILE) % WEATHER_TILE * WEATHER_TILE + (((x % WEATHER_TILE) + WEATHER_TILE) % WEATHER_TILE)) * 4 + 3] > 0;
  let leaning = 0;
  let upright = 0;
  for (let y = 0; y < WEATHER_TILE; y += 1) {
    for (let x = 0; x < WEATHER_TILE; x += 1) {
      if (!at(rain, x, y) || at(rain, x, y + 1)) continue;
      if (at(rain, x - 1, y + 1)) leaning += 1;
      else if (at(rain, x + 1, y + 1)) upright += 1;
    }
  }
  assert.ok(leaning > upright, `${leaning} leaning, ${upright} the other way`);
  // Mud is brown.
  const mud = weatherPattern("mud");
  for (let index = 0; index < mud.data.length; index += 4) {
    if (mud.data[index + 3] === 0) continue;
    assert.ok(mud.data[index] > mud.data[index + 1] && mud.data[index + 1] > mud.data[index + 2]);
  }
});

test("weather that moves moves rigidly, a step at a time, and its tile meets itself at the edges", () => {
  for (const state of WEATHER_DRAWN) {
    assert.equal(weatherDrifts(state), Object.hasOwn(WEATHER_DRIFT, state));
    const first = weatherPattern(state, 0);
    for (const step of [1, 5, 33]) {
      const later = weatherPattern(state, step);
      const [across, down] = WEATHER_DRIFT[state] ?? [0, 0];
      for (let y = 0; y < WEATHER_TILE; y += 1) {
        for (let x = 0; x < WEATHER_TILE; x += 1) {
          const fromX = (((x - across * step) % WEATHER_TILE) + WEATHER_TILE) % WEATHER_TILE;
          const fromY = (((y - down * step) % WEATHER_TILE) + WEATHER_TILE) % WEATHER_TILE;
          const a = (y * WEATHER_TILE + x) * 4;
          const b = (fromY * WEATHER_TILE + fromX) * 4;
          assert.deepEqual([...later.data.subarray(a, a + 4)], [...first.data.subarray(b, b + 4)], `${state} at step ${step}, ${x},${y}`);
        }
      }
    }
  }
  // The same step is the same picture.
  assert.deepEqual(weatherPattern("rain", 7).data, weatherPattern("rain", 7).data);
  assert.notDeepEqual(weatherPattern("rain", 1).data, weatherPattern("rain", 0).data);
  assert.equal(weatherImageId("snow"), "oh-weather-snow");
});

test("ice is pale blue-white all over with darker cracks; water that can freeze, faint dashes; the chip a dark box", () => {
  const ice = icePattern();
  assert.deepEqual([ice.width, ice.height], [ICE_TILE, ICE_TILE]);
  let pale = 0;
  let cracked = 0;
  for (let at = 0; at < ice.data.length; at += 4) {
    const [red, green, blue, alpha] = ice.data.subarray(at, at + 4);
    assert.ok(alpha > 200, "covered all over");
    assert.ok(blue >= green && green >= red, "blue-white, never purple");
    if (red > 200) pale += 1;
    else if (red < 140) cracked += 1;
  }
  assert.ok(pale > ICE_TILE * ICE_TILE * 0.8, "mostly pale");
  assert.ok(cracked > 150, `cracked: ${cracked}`);
  const hint = iceHintPattern();
  const dashes = shown(hint);
  assert.ok(dashes > 0 && dashes < hint.width * hint.height * 0.1, "a few faint dashes, the water showing through");
  const chip = chipPicture();
  assert.deepEqual([chip.width, chip.height], [CHIP_TILE, CHIP_TILE]);
  const middle = (12 * CHIP_TILE + 12) * 4;
  assert.ok(chip.data[middle] < 40 && chip.data[middle + 3] > 200, "dark in the middle");
  assert.equal(chip.data[3], 0, "its corners rounded off");
  assert.deepEqual(CHIP_STRETCH.content, [5, 4, 19, 20]);
});

test("the battlefields drawn are those being fought over whose brief says the day's weather", () => {
  const list = weatherFrontsOf([
    battlefield(),
    battlefield({ name: "Closed", status: "closed" }),
    battlefield({ name: "No weather", brief: {} }),
    battlefield({ name: "Odd weather", brief: { weather: { season: "winter", now: "hail" } } }),
    battlefield({ name: "No frame", frame: null }),
    battlefield({ name: "Ceasefire", status: "frozen", brief: { weather: { season: "The North, Deep Winter", now: "blizzard" } } }),
    null,
  ]);
  assert.deepEqual(list.map((front) => [front.name, front.season, front.now]), [["The Steppe", "winter", "snow"], ["Ceasefire", "The North, Deep Winter", "blizzard"]]);
  assert.deepEqual(weatherFrontsOf(undefined), []);
});

test("a chip says the season and the weather, the season of a designer's zone without the zone's name", () => {
  assert.equal(weatherChipText({ season: "winter", now: "snow" }), "Winter · snow");
  assert.equal(weatherChipText({ season: "summer", now: "clear" }), "Summer · clear");
  assert.equal(weatherChipText({ season: "", now: "fog" }), "fog");
  assert.deepEqual(chipSeasonOf("The North, Winter", ["The North"]), { text: "Winter", kind: "interface" });
  assert.deepEqual(chipSeasonOf("The North, Deep Winter", ["North", "The North"]), { text: "Deep Winter", kind: "content" });
  assert.deepEqual(chipSeasonOf("Monsoon", []), { text: "Monsoon", kind: "content" });
  assert.equal(chipSeasonOf("", []), null);
  // Each word is put into the player's language by what it is.
  const asked = [];
  const text = weatherChipText({ season: "The North, Long Night", now: "blizzard" }, { zoneNames: ["The North"], label: (word, kind) => {
    asked.push([word, kind]);
    return word.toUpperCase();
  } });
  assert.equal(text, "LONG NIGHT · BLIZZARD");
  assert.deepEqual(asked, [["Long Night", "content"], ["blizzard", "interface"]]);
  assert.deepEqual(Object.values(SEASON_CHIPS).map((entry) => entry.chipLabel), ["Winter", "Spring", "Summer", "Autumn"]);
});

test("the weather lies over its battlefield as an oval, full in the middle and thinner in two steps to its rim", () => {
  const fronts = weatherFrontsOf([battlefield(), battlefield({ name: "Sunny", frame: { ...frame, lng0: 60 }, brief: { weather: { season: "summer", now: "clear" } } })]);
  const { areas, chips } = frontWeatherFeatures({ fronts });
  assert.equal(areas.features.length, WEATHER_BANDS.length, "clear weather is no area, only a chip");
  assert.deepEqual(areas.features.map((feature) => feature.properties.strength), [0.3, 0.6, 1]);
  for (const feature of areas.features) {
    assert.equal(feature.properties.pattern, "oh-weather-snow");
    assert.equal(feature.properties.wash, WEATHER_OVERLAYS.snow.wash.color);
    for (const ring of feature.geometry.coordinates) assert.deepEqual(ring[0], ring[ring.length - 1], "closed");
  }
  // The rim's bands are rings round the next, wound the other way; the middle has no hole.
  const area = (ring) => ring.slice(1).reduce((sum, point, index) => sum + (ring[index][0] * point[1] - point[0] * ring[index][1]), 0) / 2;
  const [outer, , middle] = areas.features;
  assert.equal(outer.geometry.coordinates.length, 2);
  assert.ok(Math.sign(area(outer.geometry.coordinates[0])) === -Math.sign(area(outer.geometry.coordinates[1])));
  assert.equal(middle.geometry.coordinates.length, 1);
  // Within the frame, filling it to its edges.
  const points = outer.geometry.coordinates[0];
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  assert.ok(Math.abs(Math.min(...lngs) - 30) < 1e-6 && Math.abs(Math.max(...lngs) - 36) < 1e-6);
  assert.ok(Math.min(...lats) >= 47.99 && Math.max(...lats) <= 52 && Math.max(...lats) > 50.5);
  // A chip each, over the middle of the weather.
  assert.deepEqual(chips.features.map((feature) => feature.properties.chip), ["Winter · snow", "Summer · clear"]);
  const [lng, lat] = chips.features[0].geometry.coordinates;
  assert.ok(lng === 33 && lat > 49 && lat < Math.max(...lats));
  assert.deepEqual(frontWeatherFeatures(), { areas: { type: "FeatureCollection", features: [] }, chips: { type: "FeatureCollection", features: [] } });
  // Only the weather that moves is set moving, with the box it is over.
  assert.deepEqual(driftingWeatherOf(fronts).map((entry) => entry.state), ["snow"]);
  const box = driftingWeatherOf(fronts)[0];
  assert.ok(box.west === 30 && Math.abs(box.east - 36) < 1e-9 && Math.abs(box.south - 48) < 1e-9 && box.north > box.south);
});

test("its layers are in the map's order: the weather over the walls and under the troops' ways, its chip over the troops", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  const layers = ["fronts-weather-wash", "fronts-weather-pattern", "fronts-weather-chip"];
  for (const id of layers) assert.ok(index(id) >= 0, `${id} is missing from the map's order`);
  assert.deepEqual([...layers].sort((a, b) => index(a) - index(b)), layers);
  assert.ok(index("fronts-weather-wash") > index("war-walls-teeth") && index("fronts-weather-wash") > index("group-areas-outline"));
  assert.ok(index("fronts-weather-pattern") < index("fronts-arrows-past"), "under the ways the troops came");
  assert.ok(index("fronts-weather-chip") > index("fronts-troops-name") && index("fronts-weather-chip") < index("transports-way-casing"));
  const component = read("FrontWeatherLayers.jsx");
  assert.deepEqual([...component.matchAll(/id="([a-z-]+)"/g)].map((match) => match[1]), layers, "every layer it declares is in the order, and no other");
  assert.match(read("MapScene.jsx"), /<SeaBattleLayers \/>\s*<FrontWeatherLayers \/>/);
  // Behind the player's switch; still while motion is to be reduced; its words in the player's language.
  assert.match(component, /useMapSettingDefaultOn\(MAP_SETTING_KEYS\.seasonsWeather\)/);
  assert.match(component, /if \(reduceMotionEnabled\(\)\) \{/);
  assert.match(component, /document\.hidden/);
  assert.match(component, /kind === "interface" \? uiString\(text\) : translateLabel\(text\)/);
  assert.match(component, /map\.on\("styleimagemissing", asked\);/);
  for (const name of ["frontWeatherFeatures.js", "mapPatterns.js", "FrontWeatherLayers.jsx"]) assert.doesNotMatch(read(name), /createLinearGradient|createRadialGradient|createConicGradient|gradient\(/i);
});
