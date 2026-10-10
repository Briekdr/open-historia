/*! Open Historia — battlefields and fronts: the replay of a run © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The engine works a whole turn out before any of it is shown. So that the map
// can show it happening (each troop going the way it went, the line following
// them), a battlefield keeps a replay of its last run:
//
//   replay { d, n, s, k, h, l, t }
//     d   the date of the run's first day
//     n   how many days the run was. Days are counted from 0, the state the
//         run began from, to n, the state it ended in
//     s   the day this battlefield's replay begins: 0, or the day it opened
//     k   the days the line is kept on, ascending
//     h   for each of them, the day the line began moving toward it: until
//         then it stands as the line kept before
//     l   the line on each of them (codec.js encodeLines)
//     t   a pair: each side's troops' paths (codec.js encodeTracks), in the
//         order of the record's troops
//
// A replay being shown part of the way (a turn being revealed) carries two
// marks the engine never writes, `from` and `until`: the days to play it
// between.
//
// The recorder is the engine's side of this; the rest is how the game reads
// it. Pure and deterministic, and loads in plain Node.

import { diffGameDays } from "../gameDates.js";
import { PACKED_TEXT, TRACK_DAY_MAX, decodeLines, decodeTracks, encodeLines, encodeTracks } from "./codec.js";
import { TROOP_STATES } from "./constants.js";

export const MAX_REPLAY_LINES = 36;
export const MAX_TRACK_POINTS = 32;
// How far, in cells, a point left out of a path may lie from where the points
// kept put the troop on that day.
export const TRACK_TOLERANCE = 0.1;
// Strength counts toward that too: this many points of strength as one cell.
const STRENGTH_PER_CELL = 40;
// A path is saved to 1/16 of a cell: two points nearer than that are one.
const SAME_PLACE = 1 / 32;
export const MAX_REPLAY_CHARS = 48000;
const TEXT_MAX = 200000;
const DATE_MAX = 40;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stateIndex = (value) => {
  if (typeof value === "number") return value >= 0 && value < TROOP_STATES.length ? Math.floor(value) : 0;
  const index = TROOP_STATES.indexOf(String(value ?? ""));
  return index < 0 ? 0 : index;
};

// ---- recording a run -------------------------------------------------------------

// Which points of a path to keep: the first and the last, every day what the
// troop was doing changed, and as many more as it takes for the points kept to
// put it within `tolerance` of where it was on every day. A troop is judged by
// where it was WHEN, not by the shape of its path alone, so one that waited
// and then ran is not shown ambling the whole way.
const thinTrack = (samples, tolerance) => {
  const count = samples.length;
  if (count <= 2) return samples.slice();
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  for (let index = 0; index < count - 1; index += 1) {
    if (samples[index].state !== samples[index + 1].state) keep[index] = 1;
  }
  const spans = [];
  let from = 0;
  for (let index = 1; index < count; index += 1) {
    if (!keep[index]) continue;
    spans.push(from, index);
    from = index;
  }
  while (spans.length) {
    const b = spans.pop();
    const a = spans.pop();
    if (b - a < 2) continue;
    const first = samples[a];
    const last = samples[b];
    const span = last.day - first.day;
    let worst = 0;
    let at = -1;
    for (let index = a + 1; index < b; index += 1) {
      const sample = samples[index];
      const part = span > 0 ? (sample.day - first.day) / span : 0;
      const dx = sample.x - (first.x + (last.x - first.x) * part);
      const dy = sample.y - (first.y + (last.y - first.y) * part);
      const ds = (sample.strength - (first.strength + (last.strength - first.strength) * part)) / STRENGTH_PER_CELL;
      const off = Math.sqrt(dx * dx + dy * dy + ds * ds);
      if (off > worst) {
        worst = off;
        at = index;
      }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      spans.push(a, at, at, b);
    }
  }
  const kept = [];
  for (let index = 0; index < count; index += 1) if (keep[index]) kept.push(samples[index]);
  return kept;
};

const sameStanding = (a, b) =>
  Math.abs(a.x - b.x) < SAME_PLACE && Math.abs(a.y - b.y) < SAME_PLACE && a.state === b.state && Math.abs(a.strength - b.strength) <= 2;

const packTrack = (samples, tolerance) => {
  let slack = tolerance;
  let kept = thinTrack(samples, slack);
  for (let pass = 0; pass < 8 && kept.length > MAX_TRACK_POINTS; pass += 1) {
    slack *= 1.6;
    kept = thinTrack(samples, slack);
  }
  if (kept.length > MAX_TRACK_POINTS) kept = [...kept.slice(0, MAX_TRACK_POINTS - 1), kept[kept.length - 1]];
  // A troop stays where its path ends, so an end that says nothing new is
  // not kept: one that never moved is a single point.
  while (kept.length >= 2 && sameStanding(kept[kept.length - 1], kept[kept.length - 2])) kept.pop();
  return kept;
};

// Fewer kept lines: every other one between the first and the last goes, and
// the one after it is moved toward from when the one dropped was.
const thinLines = (keys, most) => {
  let kept = keys;
  while (kept.length > most && kept.length > 2) {
    const next = [];
    let droppedHold = null;
    for (let index = 0; index < kept.length; index += 1) {
      if (index > 0 && index < kept.length - 1 && index % 2 === 1) {
        droppedHold = kept[index].hold;
        continue;
      }
      next.push(droppedHold === null ? kept[index] : { ...kept[index], hold: Math.min(kept[index].hold, droppedHold) });
      droppedHold = null;
    }
    kept = next;
  }
  return kept;
};

// Keeps a run as it is worked out, a day at a time, and hands back the replay.
// One for each battlefield, each run.
export const createReplayRecorder = () => {
  let start = -1;
  let lastDay = -1;
  let lastStrands = null;
  const keys = [];
  const tracks = [[], []];
  return {
    // The state at the end of `day` (0 is the state the run began from): the
    // line as it is to be drawn, and each side's troops in the order of their
    // lists, the fallen at strength 0. Called in order of day. The same array
    // of strands as the day before means the line did not change.
    record(day, strands, troops) {
      const at = Math.max(0, Math.min(TRACK_DAY_MAX, Math.floor(Number(day) || 0)));
      if (start < 0) start = at;
      if (strands !== lastStrands || keys.length === 0) {
        const text = typeof strands === "string" ? strands : encodeLines(strands);
        const before = keys[keys.length - 1];
        if (!before) keys.push({ day: at, hold: at, text });
        else if (text !== before.text) keys.push({ day: at, hold: Math.max(before.day, lastDay), text });
        lastStrands = strands;
      }
      lastDay = at;
      for (let side = 0; side < 2; side += 1) {
        const list = Array.isArray(troops?.[side]) ? troops[side] : [];
        const kept = tracks[side];
        for (let index = 0; index < list.length; index += 1) {
          const troop = list[index];
          if (!kept[index]) kept[index] = [];
          const samples = kept[index];
          const before = samples[samples.length - 1];
          const strength = Number(troop?.strength) > 0 ? Math.min(100, Number(troop.strength)) : 0;
          // Nothing follows a fall, and a troop is not seen before it stands.
          if (before ? before.strength <= 0 : strength <= 0) continue;
          samples.push({ day: at, x: Number(troop?.x) || 0, y: Number(troop?.y) || 0, strength, state: stateIndex(troop?.state) });
        }
      }
    },

    // The replay to save on the record. `date` is the date of the run's first
    // day and `days` how long the run was.
    finish({ date = "", days } = {}) {
      const total = Math.max(0, Math.min(TRACK_DAY_MAX, Math.floor(Number.isFinite(Number(days)) ? Number(days) : lastDay)));
      let kept = thinLines(keys, MAX_REPLAY_LINES);
      const pack = (tolerance) => tracks.map((side) => {
        const paths = [];
        for (let index = 0; index < side.length; index += 1) paths.push(side[index] ? packTrack(side[index], tolerance) : []);
        return encodeTracks(paths);
      });
      let tolerance = TRACK_TOLERANCE;
      let texts = pack(tolerance);
      const size = () => kept.reduce((sum, key) => sum + key.text.length, 0) + texts[0].length + texts[1].length;
      // Too much to save: fewer lines first, since the map moves the line
      // across the gap between two that are kept, then coarser paths.
      while (size() > MAX_REPLAY_CHARS && kept.length > 2) kept = thinLines(kept, Math.max(2, Math.ceil(kept.length / 2)));
      for (let pass = 0; pass < 4 && size() > MAX_REPLAY_CHARS; pass += 1) {
        tolerance *= 2;
        texts = pack(tolerance);
      }
      return {
        d: String(date ?? "").slice(0, DATE_MAX),
        n: Math.max(total, lastDay < 0 ? 0 : lastDay),
        s: Math.max(0, start),
        k: kept.map((key) => key.day),
        h: kept.map((key) => key.hold),
        l: kept.map((key) => key.text),
        t: texts,
      };
    },
  };
};

// ---- the saved replay ---------------------------------------------------------------

const wholeDay = (value, most) => {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 0) return 0;
  return number > most ? most : number;
};
const packed = (value) => (typeof value === "string" && value.length <= TEXT_MAX && PACKED_TEXT.test(value) ? value : "");

// Shape and length only: the engine wrote it, and the world is read too often
// to decode it here. A replay this function made is handed back as it is, so
// what has been decoded from it (replayOf) is decoded once.
const made = new WeakSet();
export const normalizeReplay = (raw) => {
  if (!isRecord(raw) || !Array.isArray(raw.l) || raw.l.length === 0) return null;
  if (made.has(raw)) return raw;
  const n = wholeDay(raw.n, TRACK_DAY_MAX);
  const k = [];
  const h = [];
  const l = [];
  let last = -1;
  for (let index = 0; index < raw.l.length && l.length < MAX_REPLAY_LINES; index += 1) {
    const text = raw.l[index];
    if (typeof text !== "string" || text.length > TEXT_MAX || !PACKED_TEXT.test(text)) continue;
    const day = wholeDay(Array.isArray(raw.k) ? raw.k[index] : 0, n);
    if (day < last) continue;
    const hold = wholeDay(Array.isArray(raw.h) ? raw.h[index] : day, n);
    k.push(day);
    h.push(last < 0 ? day : Math.max(last, Math.min(day, hold)));
    l.push(text);
    last = day;
  }
  if (l.length === 0) return null;
  const replay = {
    d: String(raw.d ?? "").replace(/\s+/g, " ").trim().slice(0, DATE_MAX),
    n,
    s: wholeDay(raw.s, n),
    k,
    h,
    l,
    t: [packed(Array.isArray(raw.t) ? raw.t[0] : ""), packed(Array.isArray(raw.t) ? raw.t[1] : "")],
  };
  if (Number.isFinite(raw.until)) {
    replay.until = Math.max(0, Math.min(n, Number(raw.until)));
    replay.from = Number.isFinite(raw.from) ? Math.max(0, Math.min(replay.until, Number(raw.from))) : replay.until;
  }
  made.add(replay);
  return replay;
};

// The same replay, to be played between two of its days: a turn being
// revealed shows the days an event covers and stops there.
export const replayBetween = (replay, from, until) => {
  if (!replay) return replay;
  const end = Math.max(0, Math.min(replay.n, Number(until) || 0));
  const marked = { ...replay, from: Math.max(0, Math.min(end, Number(from) || 0)), until: end };
  made.add(marked);
  return marked;
};

// The day of the run a date falls on, held to the run; null for no date, or
// one the calendar cannot place.
export const replayDayOn = (replay, date) => {
  if (!replay || date === null || date === undefined || date === "") return null;
  const days = diffGameDays(replay.d, date);
  if (days === null) return null;
  return days < 0 ? 0 : days > replay.n ? replay.n : days;
};

// A replay with nothing left to play: the line as the run left it and every
// troop where it ended. What a copy of the world kept only to go back to (a
// restore point) needs of it, at a fraction of the size.
export const stillReplay = (replay) => {
  if (!replay || !Array.isArray(replay.l) || replay.l.length === 0) return replay;
  const ends = (text) => encodeTracks(decodeTracks(text).map((samples) => {
    const last = samples[samples.length - 1];
    return last ? [{ ...last, day: 0 }] : [];
  }));
  const still = { d: "", n: 0, s: 0, k: [0], h: [0], l: [replay.l[replay.l.length - 1]], t: [ends(replay.t[0]), ends(replay.t[1])] };
  made.add(still);
  return still;
};

// A saved replay, read: each kept line as strands, each troop's path as its
// points. A copy made to be shown part of the way shares its lines with the
// replay it was made from, and so shares this.
//
//   { date, days, start, keys: [{ day, hold, lines }], tracks: [[path], [path]] }
const read = new WeakMap();
export const replayOf = (battlefield) => {
  const replay = battlefield?.replay;
  if (!replay || !Array.isArray(replay.l) || replay.l.length === 0) return null;
  let known = read.get(replay.l);
  if (!known) {
    known = {
      date: replay.d,
      days: replay.n,
      start: replay.s,
      keys: replay.l.map((text, index) => ({ day: replay.k[index], hold: replay.h[index], lines: decodeLines(text) })),
      tracks: [decodeTracks(replay.t[0]), decodeTracks(replay.t[1])],
    };
    read.set(replay.l, known);
  }
  return known;
};

// The days a replay is to be played between, or null to show it as it ended.
export const replayWindowOf = (battlefield) => {
  const replay = battlefield?.replay;
  return replay && Number.isFinite(replay.until) ? { from: replay.from, until: replay.until } : null;
};

// Where a troop was on a day of the run (a fraction of a day is fine), by its
// path: null before it stood, and where it ended ever after. Straight between
// the points kept; the map rounds the corners (Game/Map/frontGeometry.js).
export const trackAt = (track, day) => {
  if (!track || track.length === 0 || day < track[0].day) return null;
  const last = track[track.length - 1];
  if (day >= last.day) return { x: last.x, y: last.y, strength: last.strength, state: last.state, moving: false };
  let index = 1;
  while (track[index].day < day) index += 1;
  const from = track[index - 1];
  const to = track[index];
  const span = to.day - from.day;
  const part = span > 0 ? (day - from.day) / span : 1;
  return {
    x: from.x + (to.x - from.x) * part,
    y: from.y + (to.y - from.y) * part,
    strength: from.strength + (to.strength - from.strength) * part,
    // What it was doing on the way to a point is what that point says.
    state: to.state,
    moving: Math.abs(to.x - from.x) >= SAME_PLACE || Math.abs(to.y - from.y) >= SAME_PLACE,
  };
};
