/*! Open Historia — the music a scenario asks for © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A scenario may name tracks from the community hub's music list for four
// situations of a game. It keeps only which tracks, never the music itself:
//
//   music: { loading: [ { id, version } ], game: [...], atWar: [...], battle: [...] }
//
//   loading  the game is opening under its cover;
//   game     in the game;
//   atWar    in the game while the player is at war, outside the war room;
//   battle   the war room is open, or a battlefield is shown.
//
// Each list is in the order its tracks play, twelve at most. A track's name,
// its credit and where its file is always come from the hub's list when it is
// about to play (src/runtime/hubMusic.js), so a track the hub has taken down
// stops playing everywhere, and nothing here can point a game at a file. An
// empty list is the game's own music for that situation, and a scenario with
// four empty lists has no `music` at all.
//
// Pure and dependency-free: the desktop store (server/libraryStore.js) and the
// web store (src/runtime/web/models.js) read and write the record through
// these functions, and so do the editor and the suggested-changes diff, so
// they never disagree.

export const SCENARIO_MUSIC_SITUATIONS = Object.freeze(["loading", "game", "atWar", "battle"]);
export const MAX_SCENARIO_MUSIC_TRACKS = 12;

// A track's id as the hub writes it ("passage-of-time"): letters, digits,
// dots, dashes and underscores. Anything else is not an id, whoever wrote it.
const TRACK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const musicTrackId = (value) => (typeof value === "string" && TRACK_ID.test(value) ? value : "");

// Which upload of the track the author chose. The hub counts them from 1; one
// that is missing or is not such a number reads as the first.
const trackVersion = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 1);

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const trackList = (raw) => {
  const list = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const id = isRecord(entry) ? musicTrackId(entry.id) : "";
    if (!id) continue;
    list.push({ id, version: trackVersion(entry.version) });
    if (list.length >= MAX_SCENARIO_MUSIC_TRACKS) break;
  }
  return list;
};

// The record as it is stored and exported, or null when it names no track.
// Read as a stranger's: a bundle is a file anybody can write.
export const normalizeScenarioMusic = (raw) => {
  if (!isRecord(raw)) return null;
  const music = {};
  for (const situation of SCENARIO_MUSIC_SITUATIONS) music[situation] = trackList(raw[situation]);
  return SCENARIO_MUSIC_SITUATIONS.some((situation) => music[situation].length) ? music : null;
};

// The field of a scenario's details and of a bundle's `scenario` object: there
// only while the scenario names a track, so every other scenario's record and
// file read as they always have.
export const scenarioMusicField = (raw) => {
  const music = normalizeScenarioMusic(raw);
  return music ? { music } : {};
};

// Every track a record names, once each, in the order they are first met.
export const scenarioMusicTrackIds = (raw) => {
  const music = normalizeScenarioMusic(raw);
  if (!music) return [];
  return [...new Set(SCENARIO_MUSIC_SITUATIONS.flatMap((situation) => music[situation].map((entry) => entry.id)))];
};
