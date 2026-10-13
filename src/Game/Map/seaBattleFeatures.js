/*! Open Historia — sea battles as the map marks them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the map draws of the world's sea battles (runtime/naval/record.js): a
// mark where each of the last turns' battles was fought, who fought it and
// when, in the colour of how it went for whoever looks at the map. The
// newest turn's stand out; the turn before's are fainter, and then they go.
//
// Pure: points out of records. The layers are SeaBattleLayers.jsx.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const collection = (features) => ({ type: "FeatureCollection", features });
export const EMPTY_SEA_BATTLE_FEATURES = Object.freeze(collection([]));

// How a battle went, to whoever looks at the map: "own" when the side the
// viewer fought on had the better of it, "enemy" when the other side had, and
// "other" when neither had or the viewer was no part of it.
export const seaBattleTone = (battle, viewer) => {
  if (!fold(viewer) || (battle?.winner !== 0 && battle?.winner !== 1)) return "other";
  const mine = [0, 1].find((side) => list(battle?.sides?.[side]).some((name) => fold(name) === fold(viewer)));
  if (mine === undefined) return "other";
  return battle.winner === mine ? "own" : "enemy";
};

//   battles   world.seaBattles
//   viewer    the country the player plays
// Returns a feature collection of points: { id, tone, label, fresh }.
export const seaBattleFeatures = ({ battles = [], viewer = "" } = {}) => {
  const kept = list(battles).filter((battle) => battle && clean(battle.id) && Number.isFinite(Number(battle.lng)) && Number.isFinite(Number(battle.lat)));
  const newest = kept.reduce((most, battle) => Math.max(most, Number(battle.round) || 0), 0);
  return collection(kept.map((battle) => {
    const sides = [0, 1].map((side) => list(battle.sides?.[side]).map(clean).filter(Boolean).join(", "));
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(battle.lng), Number(battle.lat)] },
      properties: {
        id: clean(battle.id),
        tone: seaBattleTone(battle, viewer),
        // (Names and a date: nothing here is the interface's own wording.)
        label: [sides.filter(Boolean).join(" – "), clean(battle.date)].filter(Boolean).join("\n"),
        fresh: (Number(battle.round) || 0) >= newest,
      },
    };
  }));
};
