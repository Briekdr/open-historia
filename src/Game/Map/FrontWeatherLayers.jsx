/*! Open Historia — the weather on the map: patches in the climate zones' own shapes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "The weather patches should be drawn by scenario designers who can choose
// the climate regions" (the owner, 2026-10-14). Each climate zone a designer
// painted shows its weather as a patch in the zone's own shape, full in its
// middle and thinning across its edge into the zones beside it, like the
// biomes of a map of the world (weatherPatches.js): streaks of rain, flakes of
// snow, a blizzard's white veil, a fog's grey one, mud, heat, frost; and a chip
// in it saying its season and weather, "Winter · snow". A battlefield in no
// zone has a chip over it and no patch. The pictures are flat tiles
// (mapPatterns.js), and the weather that moves moves: the map is handed the
// next step of its picture a few times a second, while such weather is on the
// screen, the page is in view and nothing asks for less motion (Reduce motion,
// or the system's setting). It is shown while the player's Seasons and weather
// switch is on (Settings → Map) and the scenario's wars have weather.
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
import { MAP_SETTING_KEYS, reduceMotionEnabled, useMapSettingDefaultOn } from "../../runtime/mapSettings.js";
import { isTouchPrimary } from "../../runtime/mobileUi.js";
import { translateLabel, uiString } from "../../runtime/translator.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { warSettingsOf } from "../../runtime/warSettings.js";
import { zoneWeatherFor } from "../../runtime/zoneWeather.js";
import { battleChipFeatures, weatherFrontsOf } from "./frontWeatherFeatures.js";
import { CHIP_STRETCH, WEATHER_CHIP_IMAGE, WEATHER_DRAWN, chipPicture, weatherImageId, weatherPattern } from "./mapPatterns.js";
import { useLayerOrder } from "./useLayerOrder.js";
import { weatherPatchFeatures, zoneWeatherById } from "./weatherPatches.js";

const AREAS = "fronts-weather-source";
const CHIPS = "fronts-weather-chips-source";
const LAYERS = ["fronts-weather-wash", "fronts-weather-pattern", "fronts-weather-chip"];
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
// Steps of the weather a second, and fewer on a phone.
const STEP_MS = 125;
const STEP_MS_TOUCH = 250;

// Puts a picture on the map when it has not got it: the weather's at the step
// it has reached, and the chip's.
const provide = (map, id, step = 0) => {
  try {
    if (!id || map.hasImage(id)) return;
    if (id === WEATHER_CHIP_IMAGE) {
      map.addImage(id, chipPicture(), { pixelRatio: 1, ...CHIP_STRETCH });
      return;
    }
    const state = WEATHER_DRAWN.find((each) => weatherImageId(each) === id);
    if (state) map.addImage(id, weatherPattern(state, step), { pixelRatio: 1 });
  } catch { /* the map is between styles: asked again when the next one has loaded */ }
};

// Whether a box of the map is on the screen.
const inView = (map, box) => {
  try {
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    if (box.north < bounds.getSouth() || box.south > bounds.getNorth()) return false;
    if (east - west >= 360) return true;
    // (The box and the view compared in the same turn of the world.)
    const middle = (west + east) / 2;
    const shift = Math.round(((box.west + box.east) / 2 - middle) / 360) * 360;
    return box.east - shift >= west && box.west - shift <= east;
  } catch {
    return false;
  }
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
    if (!shown) return { areas: { type: "FeatureCollection", features: [] }, chips: { type: "FeatureCollection", features: [] }, drifting: [] };
    const patches = weatherPatchFeatures({ zones, weather, label });
    const zoneNames = zones.map((zone) => String(zone?.name ?? ""));
    const battles = battleChipFeatures({ fronts, zoneNames, label });
    return { areas: patches.areas, chips: { type: "FeatureCollection", features: [...patches.chips.features, ...battles.features] }, drifting: patches.drifting };
  }, [shown, zones, weather, fronts, wordsEpoch]);
  const states = useMemo(() => [...new Set(data.areas.features.map((feature) => feature.properties.weather))].sort(), [data]);

  // The pictures: those of the weathers on the map and the chip's, now, after
  // every change of style, and the moment the map asks for one.
  const stateKey = states.join("|");
  useEffect(() => {
    if (!map || !shown) return undefined;
    const ids = [WEATHER_CHIP_IMAGE, ...stateKey.split("|").filter(Boolean).map(weatherImageId)];
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

  // The weather that moves, moved a step at a time while it can be seen.
  const drifting = data.drifting;
  useEffect(() => {
    if (!map || !shown || drifting.length === 0) return undefined;
    const moving = [...new Set(drifting.map((entry) => entry.state))];
    let step = 0;
    let held = false;
    let timer = 0;
    const tick = () => {
      timer = setTimeout(tick, isTouchPrimary() ? STEP_MS_TOUCH : STEP_MS);
      try {
        if (!map.style) return;
        // Asked for less motion: the weather stands still, at its first step.
        if (reduceMotionEnabled()) {
          if (!held) {
            step = 0;
            for (const state of moving) if (map.hasImage(weatherImageId(state))) map.updateImage(weatherImageId(state), weatherPattern(state, 0));
            map.triggerRepaint();
            held = true;
          }
          return;
        }
        held = false;
        if (typeof document !== "undefined" && document.hidden) return;
        if (map.getZoom() < WEATHER_MIN_ZOOM) return;
        const seen = new Set(drifting.filter((entry) => inView(map, entry)).map((entry) => entry.state));
        if (seen.size === 0) return;
        step += 1;
        for (const state of seen) if (map.hasImage(weatherImageId(state))) map.updateImage(weatherImageId(state), weatherPattern(state, step));
        map.triggerRepaint();
      } catch { /* the map is between styles */ }
    };
    timer = setTimeout(tick, STEP_MS);
    return () => clearTimeout(timer);
  }, [map, shown, drifting]);

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
          paint={{
            "fill-pattern": ["get", "pattern"],
            "fill-opacity": PATTERN_OPACITY,
            "fill-antialias": false,
          }}
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
