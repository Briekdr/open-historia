/*! Open Historia — frozen water as the map marks it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Water a scenario lets freeze (runtime/warGeography.js freezingRegions) that
// the last turn left frozen hard enough to cross (world.frozenRegions, written
// by the turn from fronts/climate.js) is drawn as ice: so that it is seen to be
// frozen by looking. Water that can freeze and has not is marked only faintly,
// and only while the map shows the seasons.
//
// The ice is laid over the regions themselves, by id, on the sources the map
// already draws them from (Nations.jsx): the scenario's own regions, and for a
// region the map had to repair, the repair, which is drawn in its place.
//
// Pure: which regions, and the filters that pick them out. The layers are
// IceLayers.jsx.

import { normalizeFreezingRegions } from "../../runtime/warGeography.js";

// A region's id on the map's region sources, as Nations.jsx reads it (made
// anew for each filter: the map keeps what it is handed).
export const regionIdExpression = () => ["to-string", ["coalesce", ["get", "id"], ["get", "GID_1"], ""]];

// The water to draw: { frozen, hint }, each a sorted list of region ids.
// `hint` is the water that can freeze and is not frozen, and only when asked for.
export const iceRegionIds = ({ frozen = [], freezing = [], hint = false } = {}) => {
  const iced = normalizeFreezingRegions(frozen).sort();
  const known = new Set(iced);
  return {
    frozen: iced,
    hint: hint ? normalizeFreezingRegions(freezing).filter((id) => !known.has(id)).sort() : [],
  };
};

// The filter that picks out the regions with these ids, leaving out those in
// `except` (another source draws them), or null when that leaves none.
export const regionIdFilter = (ids, except = []) => {
  const skip = new Set(Array.isArray(except) ? except.map(String) : []);
  const kept = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => id && !skip.has(id));
  return kept.length > 0 ? ["match", regionIdExpression(), kept, true, false] : null;
};

// The ice's filters on the scenario's own regions and on the repair: for each
// of `frozen` and `hint`, { own, repair }, a filter or null. `repaired` are the
// ids the repair source holds.
export const iceFilters = ({ frozen = [], hint = [], repaired = [] } = {}) => {
  const mended = new Set(Array.isArray(repaired) ? repaired.map(String) : []);
  const split = (ids) => ({
    own: regionIdFilter(ids, [...mended]),
    repair: regionIdFilter(ids.filter((id) => mended.has(String(id)))),
  });
  return { frozen: split(frozen), hint: split(hint) };
};

// The ids a GeoJSON feature collection holds, sorted, as the region sources key them.
export const featureIdsOf = (data) => [...new Set((Array.isArray(data?.features) ? data.features : [])
  .map((feature) => String(feature?.properties?.id ?? feature?.properties?.GID_1 ?? feature?.id ?? "").trim())
  .filter(Boolean))].sort();
