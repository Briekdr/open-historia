/*! Open Historia — sea battles on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The battles the last turns' fleets fought (runtime/naval/engine.js), marked
// on the game's map where they were fought: a ring and a cross in the colour
// of how it went for the player, and under it who fought and when
// (seaBattleFeatures.js). They are kept for two turns (runtime/naval/record.js)
// and the older turn's are fainter. Nothing in it can be clicked: what a
// battle did to the fleets is on the fleets, which have counters of their own.

import React, { useEffect, useMemo } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { normalizeSeaBattles } from "../../runtime/naval/record.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import { seaBattleFeatures } from "./seaBattleFeatures.js";
import { TRANSPORT_TONES } from "./transportIcons.js";

const SOURCE = "seabattles-source";
const NONE = Object.freeze([]);
const selectBattles = (world) => (Array.isArray(world?.seaBattles) ? world.seaBattles : NONE);
const selectCountry = (game) => String(game?.country ?? "");

// The colours the transporters have: the player's own, an enemy's, anyone else's.
const TONE_COLOUR = ["match", ["get", "tone"], "own", TRANSPORT_TONES.own, "enemy", TRANSPORT_TONES.enemy, TRANSPORT_TONES.other];
const SHOWN = ["case", ["get", "fresh"], 1, 0.5];
const EDGE = "rgba(5, 8, 13, 0.92)";

const SeaBattleLayers = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const raw = useRuntimeState("world", selectBattles);
  const country = useRuntimeState("game", selectCountry);
  const data = useMemo(() => seaBattleFeatures({ battles: normalizeSeaBattles(raw), viewer: country }), [raw, country]);

  const any = data.features.length > 0;
  useEffect(() => {
    if (!any || !map) return;
    try {
      enforceMapLayerOrder(map);
    } catch { /* the map is between styles */ }
  }, [any, map, data]);

  if (!any) return null;
  return (
    <Source id={SOURCE} type="geojson" data={data}>
      <Layer
        id="seabattles-ring"
        type="circle"
        paint={{
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 7, 6, 11, 9, 14],
          "circle-color": "rgba(5, 8, 13, 0.6)",
          "circle-opacity": SHOWN,
          "circle-stroke-color": TONE_COLOUR,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2, 1.5, 7, 2.5],
          "circle-stroke-opacity": SHOWN,
        }}
      />
      <Layer
        id="seabattles-mark"
        type="symbol"
        layout={{
          "text-field": "×",
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 13, 6, 19, 9, 24],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        }}
        paint={{ "text-color": TONE_COLOUR, "text-opacity": SHOWN }}
      />
      <Layer
        id="seabattles-label"
        type="symbol"
        minzoom={3}
        layout={{
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 11,
          "text-anchor": "top",
          "text-offset": [0, 1.4],
          "text-max-width": 14,
          "text-optional": true,
        }}
        paint={{ "text-color": TONE_COLOUR, "text-opacity": SHOWN, "text-halo-color": EDGE, "text-halo-width": 1.5 }}
      />
    </Source>
  );
};

export default SeaBattleLayers;
