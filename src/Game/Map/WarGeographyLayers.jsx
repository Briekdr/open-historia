/*! Open Historia — what a scenario draws on its map for war, on the game's map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario's ground harder to cross and its fortified lines
// (runtime/warGeography.js), drawn as warGeographyFeatures.js lays them out:
// each terrain area a shade with a dashed edge, the darker the higher its
// level; each wall a thick dark line with a pale core and teeth along one
// side, broken off where it has been breached with a faint line of rubble in
// the gap, and a line still being built lighter and dashed, as far as the work
// has got drawn stronger.
//
// Each is drawn only where the scenario fights its wars with it
// (runtime/warSettings.js: terrain, walls). Nothing in it can be clicked.

import React, { useMemo } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { warSettingsOf } from "../../runtime/warSettings.js";
import { useLayerOrder } from "./useLayerOrder.js";
import { fortificationFeatures, terrainAreaFeatures } from "./warGeographyFeatures.js";

const TERRAIN = "war-terrain-source";
const WALLS = "war-walls-source";
const LAYERS = ["war-terrain-fill", "war-terrain-outline", "war-walls-rubble", "war-walls-planned", "war-walls-progress", "war-walls-casing", "war-walls-core", "war-walls-teeth"];
const NONE = Object.freeze([]);
const selectAreas = (world) => (warSettingsOf(world).mechanics.terrain && Array.isArray(world?.terrainAreas) ? world.terrainAreas : NONE);
const selectLines = (world) => (warSettingsOf(world).mechanics.walls && Array.isArray(world?.fortifications) ? world.fortifications : NONE);
const selectFlat = (world) => world?.projection?.type === "freeform";
const selectDate = (game) => String(game?.gameDate || game?.startDate || "");

const SHADE = "#2b2116";
const EDGE = "#1a140d";
const WALL = "#1d1915";
const STONE = "#b9ad94";
const part = (name) => ["==", ["get", "part"], name];
// A wall's width in px: heavier the higher its level (its `weight`), and the closer the map is seen from.
const wallWidth = (factor) => ["interpolate", ["linear"], ["zoom"],
  3, ["*", 2.6 * factor, ["get", "weight"]],
  6, ["*", 5 * factor, ["get", "weight"]],
  9, ["*", 8 * factor, ["get", "weight"]],
  12, ["*", 11 * factor, ["get", "weight"]],
];
const LINE_WIDTH = ["interpolate", ["linear"], ["zoom"], 2, ["*", 0.6, ["get", "lineWidth"]], 6, ["get", "lineWidth"], 10, ["*", 1.5, ["get", "lineWidth"]]];

const WarGeographyLayers = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const areas = useRuntimeState("world", selectAreas);
  const lines = useRuntimeState("world", selectLines);
  const flat = useRuntimeState("world", selectFlat);
  const date = useRuntimeState("game", selectDate);
  const terrain = useMemo(() => terrainAreaFeatures(areas), [areas]);
  const walls = useMemo(() => fortificationFeatures({ lines, date, flat }), [lines, date, flat]);
  const shaded = terrain.features.length > 0;
  const walled = walls.features.length > 0;
  useLayerOrder(map, LAYERS, shaded || walled);

  if (!shaded && !walled) return null;
  return (
    <>
      {shaded && (
        <Source id={TERRAIN} type="geojson" data={terrain} tolerance={0.3}>
          <Layer
            id="war-terrain-fill"
            type="fill"
            paint={{ "fill-color": SHADE, "fill-opacity": ["get", "fillOpacity"], "fill-antialias": false }}
          />
          <Layer
            id="war-terrain-outline"
            type="line"
            layout={{ "line-join": "round" }}
            paint={{
              "line-color": EDGE,
              "line-opacity": ["get", "lineOpacity"],
              "line-width": LINE_WIDTH,
              "line-dasharray": [3, 2],
            }}
          />
        </Source>
      )}
      {walled && (
        <Source id={WALLS} type="geojson" data={walls} tolerance={0.2}>
          <Layer
            id="war-walls-rubble"
            type="line"
            filter={part("rubble")}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": WALL, "line-opacity": 0.55, "line-width": wallWidth(0.4), "line-dasharray": [0.1, 2.2] }}
          />
          <Layer
            id="war-walls-planned"
            type="line"
            filter={part("planned")}
            layout={{ "line-join": "round" }}
            paint={{ "line-color": WALL, "line-opacity": 0.38, "line-width": wallWidth(0.7), "line-dasharray": [1.6, 1.2] }}
          />
          <Layer
            id="war-walls-progress"
            type="line"
            filter={part("progress")}
            layout={{ "line-join": "round" }}
            paint={{ "line-color": WALL, "line-opacity": 0.78, "line-width": wallWidth(0.7), "line-dasharray": [1.6, 1.2] }}
          />
          <Layer
            id="war-walls-casing"
            type="line"
            filter={part("wall")}
            layout={{ "line-cap": "butt", "line-join": "round" }}
            paint={{ "line-color": WALL, "line-opacity": 0.92, "line-width": wallWidth(1) }}
          />
          <Layer
            id="war-walls-core"
            type="line"
            filter={part("wall")}
            layout={{ "line-cap": "butt", "line-join": "round" }}
            paint={{ "line-color": STONE, "line-opacity": 0.85, "line-width": wallWidth(0.28) }}
          />
          {/* The teeth: short blocks along one side of it, as a castle's wall has. */}
          <Layer
            id="war-walls-teeth"
            type="line"
            filter={part("wall")}
            layout={{ "line-cap": "butt", "line-join": "miter" }}
            paint={{
              "line-color": WALL,
              "line-opacity": 0.92,
              "line-width": wallWidth(0.55),
              "line-offset": wallWidth(0.75),
              "line-dasharray": [1, 1],
            }}
          />
        </Source>
      )}
    </>
  );
};

export default WarGeographyLayers;
