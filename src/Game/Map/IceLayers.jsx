/*! Open Historia — frozen water on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Make frozen areas look frozen too so you know its frozen by looking" (the
// owner). Water frozen hard enough for troops to cross (world.frozenRegions,
// as the last turn left it: iceFeatures.js) is covered in ice: pale
// blue-white, cracked, with a crisp light edge. It is shown whatever the
// Seasons and weather switch says, since it changes where troops can go; the
// water that can freeze and has not is marked, faintly, only while the switch
// is on.
//
// The ice is laid on the regions the map already draws (Nations.jsx), by id:
// these layers are on the scenario's own regions' source, and on the repair
// source for a region the map had to repair, which is drawn in its place.
// Those sources come and go with the map's style and its scenario, and the
// layers with them (useLayerOrder.js puts them back in their place).

import React, { useEffect, useMemo, useState } from "react";
import { Layer, useMap } from "react-map-gl/maplibre";
import { MAP_SETTING_KEYS, useMapSettingDefaultOn } from "../../runtime/mapSettings.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { warSettingsOf } from "../../runtime/warSettings.js";
import { featureIdsOf, iceFilters, iceRegionIds } from "./iceFeatures.js";
import { ICE_HINT_IMAGE, ICE_IMAGE, iceHintPattern, icePattern } from "./mapPatterns.js";
import { useLayerOrder } from "./useLayerOrder.js";

const OWN = "custom-regions-source";
const REPAIR = "custom-regions-repair-source";
const LAYERS = ["ice-hint", "ice-hint-repair", "ice-fill", "ice-fill-repair", "ice-edge", "ice-edge-repair"];
const NONE = Object.freeze([]);
const selectFrozen = (world) => (Array.isArray(world?.frozenRegions) ? world.frozenRegions : NONE);
const selectFreezing = (world) => (Array.isArray(world?.freezingRegions) ? world.freezingRegions : NONE);
const selectSeasons = (world) => warSettingsOf(world).mechanics.weather === true;

const ICE_PAINT = { "fill-pattern": ICE_IMAGE, "fill-opacity": 0.86 };
const HINT_PAINT = { "fill-pattern": ICE_HINT_IMAGE, "fill-opacity": 0.6 };
const EDGE_LAYOUT = { "line-join": "round" };
const EDGE_PAINT = {
  "line-color": "#eef6ff",
  "line-opacity": 0.95,
  "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 6, 1.6, 10, 2.4],
};

// The two pictures the ice is drawn with: put on the map when it has not got
// them, after every change of style (which takes a map's images away), and the
// moment the map asks for one it lacks.
const PICTURES = { [ICE_IMAGE]: icePattern, [ICE_HINT_IMAGE]: iceHintPattern };
const provide = (map, id) => {
  try {
    if (Object.hasOwn(PICTURES, id) && !map.hasImage(id)) map.addImage(id, PICTURES[id](), { pixelRatio: 1 });
  } catch { /* the map is between styles: asked again when the next one has loaded */ }
};

// The ids of the regions the repair source draws (Nations.jsx), read again
// when that source is made, given new data or taken away. [] while there is none.
const useRepairedIds = (map, active) => {
  const [ids, setIds] = useState(NONE);
  useEffect(() => {
    if (!map || !active) return undefined;
    let alive = true;
    let timer = 0;
    let present = null;
    const keep = (next) => setIds((was) => (was.join("\u0000") === next.join("\u0000") ? was : next));
    const read = () => {
      let source = null;
      try {
        source = map.style ? map.getSource(REPAIR) : null;
      } catch { /* the map is gone */ }
      present = Boolean(source);
      if (!source?.getData) {
        keep(NONE);
        return;
      }
      source.getData().then((data) => {
        if (alive) keep(featureIdsOf(data));
      }).catch(() => {});
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 120);
    };
    // (A tile of it loading is not new data.)
    const onSource = (event) => {
      if (event?.sourceId === REPAIR && !event.tile) later();
    };
    const onStyle = () => {
      let has = false;
      try {
        has = Boolean(map.style && map.getSource(REPAIR));
      } catch { /* the map is gone */ }
      if (has !== present) later();
    };
    read();
    map.on("sourcedata", onSource);
    map.on("styledata", onStyle);
    return () => {
      alive = false;
      clearTimeout(timer);
      map.off("sourcedata", onSource);
      map.off("styledata", onStyle);
    };
  }, [map, active]);
  return ids;
};

const IceLayers = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const frozenRaw = useRuntimeState("world", selectFrozen);
  const freezingRaw = useRuntimeState("world", selectFreezing);
  const seasons = useRuntimeState("world", selectSeasons);
  const switchedOn = useMapSettingDefaultOn(MAP_SETTING_KEYS.seasonsWeather);

  const { frozen, hint } = useMemo(
    () => iceRegionIds({ frozen: frozenRaw, freezing: freezingRaw, hint: switchedOn && seasons }),
    [frozenRaw, freezingRaw, switchedOn, seasons],
  );
  const any = frozen.length > 0 || hint.length > 0;
  const repaired = useRepairedIds(map, any);
  const filters = useMemo(() => iceFilters({ frozen, hint, repaired }), [frozen, hint, repaired]);

  useEffect(() => {
    if (!map || !any) return undefined;
    const again = () => Object.keys(PICTURES).forEach((id) => provide(map, id));
    const asked = (event) => provide(map, event?.id);
    again();
    map.on("styledata", again);
    map.on("styleimagemissing", asked);
    return () => {
      map.off("styledata", again);
      map.off("styleimagemissing", asked);
    };
  }, [map, any]);
  useLayerOrder(map, LAYERS, any);

  if (!any) return null;
  return (
    <>
      {filters.hint.own && <Layer id="ice-hint" type="fill" source={OWN} filter={filters.hint.own} paint={HINT_PAINT} />}
      {filters.hint.repair && <Layer id="ice-hint-repair" type="fill" source={REPAIR} filter={filters.hint.repair} paint={HINT_PAINT} />}
      {filters.frozen.own && <Layer id="ice-fill" type="fill" source={OWN} filter={filters.frozen.own} paint={ICE_PAINT} />}
      {filters.frozen.repair && <Layer id="ice-fill-repair" type="fill" source={REPAIR} filter={filters.frozen.repair} paint={ICE_PAINT} />}
      {filters.frozen.own && <Layer id="ice-edge" type="line" source={OWN} filter={filters.frozen.own} layout={EDGE_LAYOUT} paint={EDGE_PAINT} />}
      {filters.frozen.repair && <Layer id="ice-edge-repair" type="line" source={REPAIR} filter={filters.frozen.repair} layout={EDGE_LAYOUT} paint={EDGE_PAINT} />}
    </>
  );
};

export default IceLayers;
