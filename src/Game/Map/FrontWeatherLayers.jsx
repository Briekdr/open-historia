/*! Open Historia — the weather on the map: patches in the climate zones' own shapes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "The weather patches should be drawn by scenario designers who can choose
// the climate regions" (the owner, 2026-10-14). Each climate zone a designer
// painted shows its weather as a patch in the zone's own shape, full in its
// middle and thinning across its edge into the zones beside it, like the
// biomes of a map of the world (weatherPatches.js), and a chip in it saying its
// season and weather, "Winter · snow". A battlefield in no zone has a chip over
// it and no patch. Each weather is a still speckle, as frost is ("I like how
// frost looks, the other effects look bad"): three tiles of it of prime sizes
// laid one over another, so it does not repeat to the eye (mapPatterns.js).
// It is shown while the player's Seasons and weather switch is on (Settings →
// Map) and the scenario's wars have weather.
//
// Each zone's weather is the one the last turn wrote (world.zoneWeather, the
// same on every screen of a shared game); before the first turn it is worked
// out here as the turn would (runtime/zoneWeather.js), from this game's own id.
//
// The chips are drawn on the map, where the page's translator cannot reach
// them: their words are put into the player's language here, the season of a
// designer's own zone as the scenario's own text.

import React, { useEffect, useMemo, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { useLibraryState } from "../../runtime/library.js";
import { MAP_SETTING_KEYS, useMapSettingDefaultOn } from "../../runtime/mapSettings.js";
import { translateLabel, uiString } from "../../runtime/translator.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { warSettingsOf } from "../../runtime/warSettings.js";
import { zoneWeatherFor } from "../../runtime/zoneWeather.js";
import { battleChipFeatures, weatherFrontsOf } from "./frontWeatherFeatures.js";
import { CHIP_STRETCH, WEATHER_CHIP_IMAGE, WEATHER_DRAWN, WEATHER_LAYERS, chipPicture, weatherImageId, weatherPattern } from "./mapPatterns.js";
import { useLayerOrder } from "./useLayerOrder.js";
import { weatherPatchFeatures, zoneWeatherById } from "./weatherPatches.js";

const AREAS = "fronts-weather-source";
const CHIPS = "fronts-weather-chips-source";
const LAYERS = ["fronts-weather-wash", "fronts-weather-pattern", "fronts-weather-pattern-b", "fronts-weather-pattern-c", "fronts-weather-chip"];
const NONE = Object.freeze([]);
const selectFronts = (world) => weatherFrontsOf(world?.battlefields);
const selectZones = (world) => (Array.isArray(world?.climateZones) ? world.climateZones : NONE);
const selectRecorded = (world) => world?.zoneWeather ?? null;
const selectWeatherOn = (world) => warSettingsOf(world).mechanics.weather;
const selectDate = (game) => String(game?.gameDate || game?.startDate || "");

// The weather is seen from as far off as a battlefield's markers are, and
// thins as the map comes close, where the troops are looked at one by one.
const WEATHER_MIN_ZOOM = 2.5;
const CHIP_MIN_ZOOM = 3;
const STRENGTH = ["get", "strength"];
const PATTERN_OPACITY = ["interpolate", ["linear"], ["zoom"], 3, ["*", 0.95, STRENGTH], 7, ["*", 0.8, STRENGTH], 10, ["*", 0.55, STRENGTH]];
const WASH_OPACITY = ["interpolate", ["linear"], ["zoom"], 3, ["*", ["get", "washOpacity"], STRENGTH], 10, ["*", 0.6, ["get", "washOpacity"], STRENGTH]];
// The second and third of a weather's tiles, by the first's id.
const PATTERN_LAYERS = [["get", "pattern"], ["concat", ["get", "pattern"], "-b"], ["concat", ["get", "pattern"], "-c"]];

// Every picture the weather may ask for, by its id: each weather's three tiles, and the chip's.
const PICTURES = new Map([
  [WEATHER_CHIP_IMAGE, () => chipPicture()],
  ...WEATHER_DRAWN.flatMap((state) => WEATHER_LAYERS.map((_, layer) => [weatherImageId(state, layer), () => weatherPattern(state, layer)])),
]);
// Puts a picture on the map when it has not got it.
const provide = (map, id) => {
  try {
    if (!id || !PICTURES.has(id) || map.hasImage(id)) return;
    map.addImage(id, PICTURES.get(id)(), id === WEATHER_CHIP_IMAGE ? { pixelRatio: 1, ...CHIP_STRETCH } : { pixelRatio: 1 });
  } catch { /* the map is between styles: asked again when the next one has loaded */ }
};

const FrontWeatherLayers = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const switchedOn = useMapSettingDefaultOn(MAP_SETTING_KEYS.seasonsWeather);
  const fronts = useRuntimeState("world", selectFronts);
  const zones = useRuntimeState("world", selectZones);
  const recorded = useRuntimeState("world", selectRecorded);
  const weatherOn = useRuntimeState("world", selectWeatherOn);
  const date = useRuntimeState("game", selectDate);
  const gameId = String(useLibraryState()?.activeGameId ?? "");
  const shown = switchedOn && weatherOn !== false && (zones.length > 0 || fronts.length > 0);

  // Rebuilt when the translator has learnt new words, so the chips say them.
  const [wordsEpoch, setWordsEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setWordsEpoch((value) => value + 1);
    window.addEventListener("i18n:updated", bump);
    return () => window.removeEventListener("i18n:updated", bump);
  }, []);
  // Each zone's weather: what the last turn wrote, else as the turn would work it out.
  const weather = useMemo(
    () => (shown ? zoneWeatherById(recorded, date, zoneWeatherFor({ climateZones: zones }, { seed: gameId, date })) : new Map()),
    [shown, recorded, date, zones, gameId],
  );
  const data = useMemo(() => {
    void wordsEpoch;
    const label = (text, kind) => (kind === "interface" ? uiString(text) : translateLabel(text));
    if (!shown) return { areas: { type: "FeatureCollection", features: [] }, chips: { type: "FeatureCollection", features: [] } };
    const patches = weatherPatchFeatures({ zones, weather, label });
    const zoneNames = zones.map((zone) => String(zone?.name ?? ""));
    const battles = battleChipFeatures({ fronts, zoneNames, label });
    return { areas: patches.areas, chips: { type: "FeatureCollection", features: [...patches.chips.features, ...battles.features] } };
  }, [shown, zones, weather, fronts, wordsEpoch]);
  const states = useMemo(() => [...new Set(data.areas.features.map((feature) => feature.properties.weather))].sort(), [data]);

  // The pictures: those of the weathers on the map and the chip's, now, after
  // every change of style, and the moment the map asks for one.
  const stateKey = states.join("|");
  useEffect(() => {
    if (!map || !shown) return undefined;
    const ids = [WEATHER_CHIP_IMAGE, ...stateKey.split("|").filter(Boolean).flatMap((state) => WEATHER_LAYERS.map((_, layer) => weatherImageId(state, layer)))];
    const again = () => ids.forEach((id) => provide(map, id));
    const asked = (event) => provide(map, event?.id);
    again();
    map.on("styledata", again);
    map.on("styleimagemissing", asked);
    return () => {
      map.off("styledata", again);
      map.off("styleimagemissing", asked);
    };
  }, [map, shown, stateKey]);

  useLayerOrder(map, LAYERS, shown);

  if (!shown || (data.areas.features.length === 0 && data.chips.features.length === 0)) return null;
  return (
    <>
      <Source id={AREAS} type="geojson" data={data.areas} tolerance={0.4}>
        <Layer
          id="fronts-weather-wash"
          type="fill"
          minzoom={WEATHER_MIN_ZOOM}
          filter={["has", "wash"]}
          paint={{
            "fill-color": ["get", "wash"],
            "fill-opacity": WASH_OPACITY,
            "fill-antialias": false,
          }}
        />
        <Layer
          id="fronts-weather-pattern"
          type="fill"
          minzoom={WEATHER_MIN_ZOOM}
          filter={["has", "pattern"]}
          paint={{ "fill-pattern": PATTERN_LAYERS[0], "fill-opacity": PATTERN_OPACITY, "fill-antialias": false }}
        />
        <Layer
          id="fronts-weather-pattern-b"
          type="fill"
          minzoom={WEATHER_MIN_ZOOM}
          filter={["has", "pattern"]}
          paint={{ "fill-pattern": PATTERN_LAYERS[1], "fill-opacity": PATTERN_OPACITY, "fill-antialias": false }}
        />
        <Layer
          id="fronts-weather-pattern-c"
          type="fill"
          minzoom={WEATHER_MIN_ZOOM}
          filter={["has", "pattern"]}
          paint={{ "fill-pattern": PATTERN_LAYERS[2], "fill-opacity": PATTERN_OPACITY, "fill-antialias": false }}
        />
      </Source>
      <Source id={CHIPS} type="geojson" data={data.chips}>
        <Layer
          id="fronts-weather-chip"
          type="symbol"
          minzoom={CHIP_MIN_ZOOM}
          layout={{
            "text-field": ["get", "chip"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 7, 12],
            "text-max-width": 16,
            "icon-image": WEATHER_CHIP_IMAGE,
            "icon-text-fit": "both",
            "icon-text-fit-padding": [3, 7, 3, 7],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          }}
          paint={{
            "text-color": "#e9eef5",
          }}
        />
      </Source>
    </>
  );
};

export default FrontWeatherLayers;
