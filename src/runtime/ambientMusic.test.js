/*! Open Historia — the game's music: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/ambientMusic.test.js
//
// "Add this as ambient music in game." "Make this song play in loading screen
// then become super dramatic when you start a game and its loading then it
// dramatically stops the music at certain points in the song and a different
// song plays ingame." "When in the war room or looking at a battlefield it
// should play this." "Make it not be as dramatic when idle in the main menu
// and ramp up dramaticism when loading." "Scenario creators should be able to
// add different tracks and songs for different situations." And, of the first
// version: "its abruptly cutting to another part of the song when you open a
// new game"; "if you're in the menu for like 30 seconds it just fades out and
// resets"; "if the game loads too fast it just abruptly stops the music".
//
// What is pinned: which piece sounds in which scene; that the menu plays to
// the lull before the build, levelled, and never into the build; that a game
// opening is a crossing of two elements and never a cut on one; where the
// build comes in, from how long games take to open here, and how its loudness
// grows; that the music always reaches the big hit, unless that is far off,
// when it fades out instead; a scenario's lists in the place of the game's own
// pieces, track after track, and the game's own piece back when none of a
// list can be played; that a file is only asked for when it is about to play
// (but for the build, made ready on the menu); and that Settings says whose
// music it is, which is what the pieces' licence (CC BY 4.0) asks for.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MUSIC_VOLUME,
  LOAD_SECONDS_KEY,
  MUSIC_CREDIT,
  MUSIC_SCENES,
  MUSIC_TRACKS,
  MUSIC_WAR_PIECES,
  PASSAGE_CALM,
  PASSAGE_DRAMA,
  PASSAGE_LOADS,
  boostAt,
  calmGainAt,
  createMusicDirector,
  cutTimeAfter,
  entryFor,
  exitAfter,
  expectedLoadSeconds,
  getNowPlaying,
  holdMusic,
  loadSecondsMemory,
  musicAddress,
  musicSceneOf,
  musicVolumeOf,
  setMusicPlaylists,
  setMusicScene,
  startMusic,
  subscribeNowPlaying,
} from "./ambientMusic.js";
import { MAP_SETTING_KEYS } from "./mapSettings.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// A clock the test moves, and timers that fire as it passes them.
const clock = () => {
  let now = 0;
  let nextId = 1;
  // How many timers were asked for: how busy the director keeps the page.
  let asked = 0;
  const pending = new Map();
  const listeners = [];
  return {
    get now() { return now; },
    get asked() { return asked; },
    onAdvance: (listener) => listeners.push(listener),
    timers: {
      set: (fn, ms) => { const id = nextId; nextId += 1; asked += 1; pending.set(id, { fn, at: now + ms }); return id; },
      clear: (id) => pending.delete(id),
    },
    // Moves time on in small steps, so that timers armed by timers fire too.
    advance(ms) {
      const end = now + ms;
      while (now < end) {
        const step = Math.min(5, end - now);
        now += step;
        for (const listener of listeners) listener(step);
        for (const [id, entry] of [...pending]) {
          if (entry.at <= now && pending.delete(id)) entry.fn();
        }
      }
    },
  };
};

// An <audio> whose time moves with the clock while it plays. `lengths` says
// how long a file is (by its address; any other never ends), and `broken`
// which addresses cannot be played: such a file fails as a browser's does,
// its element saying so before play() does.
const stage = ({ enabled = true, volume = 25, refuse = null, tracks = MUSIC_TRACKS, memory = null, lengths = {}, broken = [], onNowPlaying = null } = {}) => {
  const time = clock();
  const settings = { enabled, volume };
  const made = [];
  const unplayable = new Set(broken);
  const makeAudio = () => {
    const listeners = {};
    let src = "";
    const audio = {
      paused: true, loop: false, preload: "auto", volume: 1, currentTime: 0, duration: Infinity, ended: false, error: null, plays: 0, pauses: 0, loads: 0,
      get src() { return src; },
      // Another file: from its start, with nothing held against it.
      set src(value) { src = value; audio.loads += 1; audio.currentTime = 0; audio.ended = false; audio.error = null; audio.duration = lengths[value] ?? Infinity; },
      addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
      emit(type) { for (const listener of listeners[type] ?? []) listener(); },
      play() {
        audio.plays += 1;
        if (refuse) return Promise.reject(Object.assign(new Error("refused"), { name: refuse }));
        if (unplayable.has(src)) {
          audio.paused = false;
          audio.error = { code: 4 };
          return new Promise((_resolve, reject) => queueMicrotask(() => {
            audio.emit("error");
            reject(Object.assign(new Error("no supported source"), { name: "NotSupportedError" }));
          }));
        }
        if (audio.ended) { audio.currentTime = 0; audio.ended = false; }
        audio.paused = false;
        return Promise.resolve();
      },
      pause() { audio.pauses += 1; audio.paused = true; },
    };
    made.push(audio);
    return audio;
  };
  time.onAdvance((ms) => {
    for (const audio of made) {
      if (audio.paused || audio.error) continue;
      audio.currentTime += ms / 1000;
      if (!audio.loop && audio.currentTime >= audio.duration) {
        audio.currentTime = audio.duration;
        audio.paused = true;
        audio.ended = true;
        audio.emit("ended");
      }
    }
  });
  const director = createMusicDirector({
    makeAudio,
    addressOf: (file) => `/${file}`,
    read: () => ({ ...settings }),
    timers: time.timers,
    now: () => time.now,
    memory,
    onNowPlaying,
    tracks,
  });
  const of = (name) => director.channels[name].audio;
  const list = (key) => director.lists[key];
  const audibly = (ch) => ch.audio && !ch.audio.paused && ch.audio.volume > 0;
  // The game's own pieces by name, a scenario's lists as "scenario:<situation>".
  const sounding = () => [
    ...Object.entries(director.channels).filter(([, ch]) => audibly(ch)).map(([name]) => name),
    ...Object.entries(director.lists).filter(([, ch]) => audibly(ch)).map(([key]) => `scenario:${key}`),
  ];
  return { director, made, settings, time, of, list, sounding };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const near = (actual, expected, by = 0.006) => assert.ok(Math.abs(actual - expected) <= by, `${actual} is not within ${by} of ${expected}`);
// How long games took to open, as the director keeps it between sessions.
const remembering = (seconds = []) => {
  const memory = { kept: [...seconds], read: () => [...memory.kept], write: (next) => { memory.kept = [...next]; } };
  return memory;
};
// A hub track as the director is handed it (scenarioMusic.js resolveScenarioPlaylists).
const hubTrack = (id) => ({ id, src: `/hub/${id}.mp3`, name: `Track ${id}`, credit: `Track ${id} by Somebody (CC BY 4.0)`, source: `https://example.org/${id}` });

test("the menu: nothing is made or fetched before the first click, then Passage Of Time from its start, with the build held ready", () => {
  const { director, made, time, of, sounding } = stage();
  director.sync();
  director.setHidden(false);
  time.advance(2000);
  assert.equal(made.length, 0, "no element, so no request for a file");
  director.unlock();
  // Two elements of the one file: the menu's, playing, and the build's, ready.
  assert.equal(made.length, 2);
  const audio = of("calm");
  assert.deepEqual([audio.src, audio.loop, audio.preload, audio.paused], ["/audio/passage-of-time.mp3", true, "none", false]);
  // The build: loaded, silent and paused at the entry the next game opening
  // would use. With no game timed yet that is six seconds' worth: 161.20.
  const ready = of("drama");
  assert.notEqual(ready, audio);
  assert.deepEqual([ready.src, ready.preload, ready.paused, ready.volume, ready.currentTime, ready.plays], ["/audio/passage-of-time.mp3", "auto", true, 0, 161.2, 0]);
  assert.equal(director.readyAt, 161.2);
  time.advance(3000);
  assert.deepEqual(sounding(), ["calm"]);
  // The opening is nearly inaudible as recorded: the menu turns it up.
  near(audio.volume, 0.25 * PASSAGE_CALM.most, 1e-9);
  assert.ok(audio.currentTime < 5, "from the opening");
  assert.deepEqual([ready.paused, ready.volume, ready.currentTime, ready.plays], [true, 0, 161.2, 0], "and the build has not moved");
  // A second click does not start it again.
  director.unlock();
  assert.equal(audio.plays, 1);
  assert.equal(made.length, 2);
});

test("the menu levels the piece: the gain follows its own loudness, gliding, between a least and a most", () => {
  assert.ok(Object.isFrozen(PASSAGE_CALM) && Object.isFrozen(PASSAGE_CALM.rms));
  assert.deepEqual({ ...PASSAGE_CALM, rms: null }, { fadeFrom: 141.5, end: 143.5, limit: 144.5, fadeIn: 2500, step: 5, rms: null, level: 0.065, power: 0.75, least: 0.5, most: 1.6 });
  // The piece's loudness for every five seconds from 0 to 140.
  assert.deepEqual([...PASSAGE_CALM.rms], [
    0.029, 0.033, 0.034, 0.035, 0.027, 0.050, 0.065, 0.044, 0.065, 0.051,
    0.064, 0.063, 0.058, 0.079, 0.100, 0.103, 0.113, 0.093, 0.128, 0.135,
    0.135, 0.132, 0.145, 0.127, 0.147, 0.104, 0.051, 0.066, 0.033,
  ]);
  // The opening (0.029) is turned up as far as it goes; a stretch as loud as
  // the level is left alone; the plateau (0.145) is brought down to about half.
  assert.equal(calmGainAt(2.5), 1.6);
  near(calmGainAt(32.5), 1, 1e-12);
  near(calmGainAt(112.5), (0.065 / 0.145) ** 0.75, 1e-12);
  near(calmGainAt(112.5), 0.548, 0.001);
  // Each figure stands for the middle of its five seconds, and the gain glides between them.
  near(calmGainAt(40), (0.065 / ((0.044 + 0.065) / 2)) ** 0.75, 1e-12);
  near(calmGainAt(68.75), (0.065 / (0.079 + (0.100 - 0.079) * 0.25)) ** 0.75, 1e-12);
  // Before the middle of the first stretch and after the middle of the last, theirs.
  assert.equal(calmGainAt(0), calmGainAt(2.5));
  assert.equal(calmGainAt(-3), calmGainAt(2.5));
  assert.equal(calmGainAt(143.5), calmGainAt(142.5));
  assert.equal(calmGainAt(500), calmGainAt(142.5));
  assert.equal(calmGainAt(Number.NaN), calmGainAt(0));
  // The clamps: never over the most, never under the least.
  const extremes = { ...PASSAGE_CALM, rms: [0.0001, 5] };
  assert.equal(calmGainAt(2.5, extremes), 1.6);
  assert.equal(calmGainAt(7.5, extremes), 0.5);
  let least = 9;
  let most = 0;
  let steepest = 0;
  for (let at = 0; at < PASSAGE_CALM.end; at += 0.2) {
    const gain = calmGainAt(at);
    least = Math.min(least, gain);
    most = Math.max(most, gain);
    steepest = Math.max(steepest, Math.abs(calmGainAt(at + 0.2) - gain) / gain);
  }
  assert.equal(most, 1.6);
  assert.ok(least >= 0.5 && least < 0.56, `the loudest stretch is brought down to ${least}`);
  // No audible steps: a look every 200 ms moves the gain by a few percent at most
  // (3.5% is under a third of a decibel).
  assert.ok(steepest < 0.035, `at most ${steepest} of itself a look`);
});

test("the menu plays to the lull before the build and starts again there, never fading in between", () => {
  const { director, time, of } = stage();
  director.unlock();
  const audio = of("calm");
  const volumeAt = (at) => 0.25 * calmGainAt(at);
  // Past the first minute and on, with no fade and no restart: only the levelling moves the volume.
  let steepest = 0;
  let before = audio.volume;
  for (let ms = 0; ms < 141000; ms += 200) {
    time.advance(200);
    assert.equal(audio.paused, false);
    if (ms >= 3000) {
      near(audio.volume, volumeAt(audio.currentTime), 0.012);
      steepest = Math.max(steepest, Math.abs(audio.volume - before) / before);
    }
    before = audio.volume;
  }
  near(audio.currentTime, 141, 0.02);
  assert.ok(steepest < 0.045, `the volume moves by ${steepest} of itself a look at most`);
  assert.equal(audio.plays, 1);
  // The seam: from 141.5 it fades, by 143.5 it is silent.
  time.advance(1500);
  near(audio.currentTime, 142.5, 0.02);
  near(audio.volume, volumeAt(142.5) / 2, 0.01);
  time.advance(950);
  assert.ok(audio.volume < 0.02, `all but silent at ${audio.currentTime}: ${audio.volume}`);
  assert.ok(audio.currentTime < PASSAGE_CALM.end);
  // From the top again, coming back in over two and a half seconds.
  time.advance(100);
  assert.ok(audio.currentTime < 0.1, `started again: ${audio.currentTime}`);
  assert.ok(audio.volume < 0.02, "from silence");
  assert.equal(audio.paused, false);
  const startedAgain = time.now - audio.currentTime * 1000;
  time.advance(startedAgain + 1250 - time.now);
  near(audio.volume, volumeAt(1.25) / 2, 0.01);
  time.advance(1300);
  near(audio.volume, volumeAt(2.55), 1e-9);
  assert.equal(audio.plays, 1, "the same element, never started twice");

  // Left idling for a quarter of an hour it goes round, silent at each seam,
  // and is never found past the end of its part: the build starts at 145.45.
  let latest = 0;
  let rounds = 0;
  let last = audio.currentTime;
  for (let ms = 0; ms < 15 * 60 * 1000; ms += 5) {
    time.advance(5);
    latest = Math.max(latest, audio.currentTime);
    if (audio.currentTime < last) {
      rounds += 1;
      assert.equal(audio.volume, 0, "silent as it goes back to the start");
    }
    last = audio.currentTime;
  }
  assert.ok(latest > PASSAGE_CALM.end - 0.02 && latest < PASSAGE_CALM.end + 0.02, `to the end of its part and no further: ${latest}`);
  assert.ok(latest < PASSAGE_CALM.limit);
  assert.ok(PASSAGE_CALM.limit < 145.45);
  assert.equal(rounds, 6);
  assert.equal(audio.paused, false);
  assert.equal(director.inDrama, false);
  // The build was held ready the whole time, and never sounded.
  assert.deepEqual([of("drama").paused, of("drama").plays, of("drama").currentTime], [true, 0, 161.2]);
});

test("the menu is watched slowly, and a changed volume is followed at once", () => {
  const { director, settings, time, of } = stage();
  director.unlock();
  time.advance(5000);
  // A look about every 200 ms, not every 25: under 6 a second.
  const before = time.asked;
  time.advance(50000);
  assert.ok(time.asked - before < 300, `${time.asked - before} timers in 50 seconds`);
  assert.ok(time.asked - before > 200);
  // The volume slider moved: followed at once, at the level of where the music is.
  time.advance(9500);
  near(of("calm").currentTime, 64.5, 0.02);
  settings.volume = 50;
  director.sync();
  near(of("calm").volume, 0.5 * calmGainAt(64.5), 0.01);
});

test("where a game opening comes into the build: the latest phrase that still leaves the game time to be drawn", () => {
  // Phrase starts, each just before an accent, with their lead to the big hit.
  // Never later than 164.70: even a game that opens at once has four seconds of build.
  assert.deepEqual([...PASSAGE_DRAMA.entries], [145.3, 149.75, 157.3, 161.2, 164.7]);
  assert.equal(PASSAGE_DRAMA.hit, 168.6);
  assert.deepEqual(PASSAGE_DRAMA.entries.map((entry) => Math.round((PASSAGE_DRAMA.hit - entry) * 100) / 100), [23.3, 18.85, 11.3, 7.4, 3.9]);
  for (const [expected, entry] of [[0, 164.7], [1, 164.7], [3, 164.7], [6, 161.2], [10, 157.3], [15, 149.75], [20, 145.3], [35, 145.3], [400, 145.3]]) {
    assert.equal(entryFor(expected), entry, `a game expected to take ${expected} s`);
  }
  // The lead is the load time and half a second: exactly enough is enough.
  assert.equal(entryFor(3.4), 164.7);
  assert.equal(entryFor(3.41), 161.2);
  assert.equal(entryFor(6.9), 161.2);
  assert.equal(entryFor(6.91), 157.3);
  assert.equal(entryFor(22.8), 145.3);
  assert.equal(entryFor(22.81), 145.3);
  // Nothing is known of the load: as six seconds.
  assert.equal(entryFor(Number.NaN), 161.2);
  assert.equal(entryFor(undefined), 161.2);
});

test("the build grows louder by where the music is: as the menu at the entry, the full boost at the big hit", () => {
  assert.equal(boostAt(161.2, 161.2), 1);
  assert.equal(boostAt(160.3, 161.2), 1, "and no louder while it is still coming in under the menu's music");
  near(boostAt((161.2 + 168.6) / 2, 161.2), 1.3, 1e-9);
  near(boostAt(145.3 + (168.6 - 145.3) / 4, 145.3), 1.15, 1e-9);
  assert.equal(boostAt(168.6, 161.2), PASSAGE_DRAMA.boost);
  assert.equal(boostAt(200, 161.2), PASSAGE_DRAMA.boost);
  // No entry (the loud stretch gone round again): the full boost.
  assert.equal(boostAt(170, null), PASSAGE_DRAMA.boost);
  assert.equal(boostAt(168.45, null), PASSAGE_DRAMA.boost);
  assert.equal(PASSAGE_DRAMA.boost, 1.6);
});

test("a game opening: the build comes in under the menu's music and the two cross, with no silence between", () => {
  assert.deepEqual([PASSAGE_DRAMA.crossfade, PASSAGE_DRAMA.lead], [1800, 0.9]);
  const { director, made, time, of, sounding } = stage();
  director.unlock();
  time.advance(5000);
  const calm = of("calm");
  const drama = of("drama");
  const calmLevel = 0.25 * calmGainAt(5);
  near(calm.volume, calmLevel, 1e-9);
  assert.deepEqual([drama.paused, drama.volume, drama.currentTime], [true, 0, 161.2]);

  director.setScene("loading");
  // The build starts 0.9 s before its entry, silent, with the menu's music still playing as it was.
  near(drama.currentTime, 161.2 - 0.9, 1e-9);
  assert.deepEqual([drama.paused, drama.volume, drama.plays], [false, 0, 1]);
  assert.equal(calm.paused, false);
  near(calm.volume, calmLevel, 1e-9);
  assert.equal(director.inDrama, true);
  // Through the crossing both are heard, and together they are as loud as
  // either alone: one follows a sine, the other a cosine.
  let quietest = 1;
  for (let ms = 40; ms < 1800; ms += 40) {
    time.advance(40);
    assert.deepEqual(sounding(), ["calm", "drama"], `at ${ms} ms`);
    const power = (calm.volume / calmLevel) ** 2 + (drama.volume / (0.25 * boostAt(drama.currentTime, 161.2))) ** 2;
    near(power, 1, 0.02);
    quietest = Math.min(quietest, calm.volume + drama.volume);
    if (ms === 880) {
      // The middle of it is the entry, and each is at seven tenths.
      near(drama.currentTime, 161.2, 0.03);
      near(drama.volume, 0.25 * Math.SQRT1_2, 0.01);
      near(calm.volume, calmLevel * Math.SQRT1_2, 0.01);
    }
  }
  assert.ok(quietest > 0.24, `never a dip: the two never fall under ${quietest}`);
  // After it only the build sounds; the menu's music is paused, back at its start.
  time.advance(60);
  assert.deepEqual(sounding(), ["drama"]);
  assert.deepEqual([calm.paused, calm.currentTime], [true, 0]);
  near(drama.volume, 0.25 * boostAt(drama.currentTime, 161.2), 0.002);
  assert.ok(drama.volume < 0.27, "no louder than the menu yet");
  // Halfway to the hit, halfway to the boost.
  time.advance((164.9 - drama.currentTime) * 1000);
  near(drama.currentTime, 164.9, 0.011);
  near(drama.volume, 0.25 * 1.3, 0.002);
  // At the hit and after it: the full boost.
  time.advance((168.6 - drama.currentTime) * 1000 + 30);
  near(drama.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  time.advance(5000);
  near(drama.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  assert.deepEqual([calm.plays, drama.plays, made.length], [1, 1, 2]);

  // Given up for the menu: the menu's music comes in from its start over two
  // and a half seconds while the build goes out, and the build is made ready again.
  director.setScene("menu");
  time.advance(450);
  assert.deepEqual(sounding(), ["calm", "drama"]);
  time.advance(2100);
  assert.deepEqual(sounding(), ["calm"]);
  near(calm.volume, 0.25 * PASSAGE_CALM.most, 1e-9);
  near(calm.currentTime, 2.55, 0.02);
  assert.deepEqual([drama.paused, drama.volume, drama.currentTime], [true, 0, 161.2]);
});

test("a game opened as the menu's music nears its seam: the menu's element still never plays past its part", () => {
  const { director, time, of, sounding } = stage();
  director.unlock();
  time.advance(143000);
  const calm = of("calm");
  near(calm.currentTime, 143, 0.02);
  director.setScene("loading");
  let latest = 0;
  for (let ms = 0; ms < 2000; ms += 5) {
    time.advance(5);
    latest = Math.max(latest, calm.currentTime);
  }
  assert.ok(latest < PASSAGE_CALM.end + 0.03, `stopped at the end of its part: ${latest}`);
  assert.ok(latest < PASSAGE_CALM.limit);
  assert.deepEqual([calm.paused, calm.currentTime], [true, 0]);
  assert.deepEqual(sounding(), ["drama"]);
});

test("how long games take to open is learned: the last five, their median, kept between sessions", () => {
  assert.deepEqual({ ...PASSAGE_LOADS }, { kept: 5, shortest: 0.5, least: 1, most: 40, unknown: 6, margin: 0.5 });
  assert.equal(expectedLoadSeconds([]), 6);
  assert.equal(expectedLoadSeconds(undefined), 6);
  assert.equal(expectedLoadSeconds([2, 3, 4]), 3);
  assert.equal(expectedLoadSeconds([2, 4]), 3);
  assert.equal(expectedLoadSeconds([0.6]), 1, "never under a second");
  assert.equal(expectedLoadSeconds([100, 120, 90]), 40, "never over forty");
  assert.equal(expectedLoadSeconds([9, 9, 1, 2, 3, 4, 5]), 3, "only the last five");
  assert.equal(expectedLoadSeconds([0.2, "3", null, Number.NaN, 7]), 7, "only numbers of at least half a second");

  const memory = remembering();
  const first = stage({ memory, enabled: false });
  assert.equal(first.director.expectedLoad, 6);
  // Timed with the music off and before any click: it is about the device.
  const open = (director, time, ms, into) => {
    director.setScene("loading");
    time.advance(ms);
    director.setScene(into);
    director.setScene("menu");
  };
  open(first.director, first.time, 2000, "game");
  open(first.director, first.time, 3000, "war");
  open(first.director, first.time, 4000, "atWar");
  assert.deepEqual(memory.kept, [2, 3, 4]);
  assert.equal(first.director.expectedLoad, 3);
  assert.equal(first.made.length, 0, "and nothing was played to learn it");
  // Not a loading: one given up for the menu, and one too short to be one.
  first.director.setScene("loading");
  first.time.advance(9000);
  first.director.setScene("menu");
  open(first.director, first.time, 300, "game");
  assert.deepEqual(memory.kept, [2, 3, 4]);

  // The next session expects what the last one learned: three seconds, so
  // the build is held ready at 164.70, and comes in there.
  const second = stage({ memory });
  assert.equal(second.director.expectedLoad, 3);
  second.director.unlock();
  assert.equal(second.of("drama").currentTime, 164.7);
  second.time.advance(4000);
  second.director.setScene("loading");
  near(second.of("drama").currentTime, 164.7 - 0.9, 1e-9);
  second.time.advance(1000);
  near(second.of("drama").currentTime, 164.7 + 0.1, 0.011);
  // Only the last five are kept.
  second.director.setScene("game");
  for (const ms of [5000, 6000, 7000, 8000]) open(second.director, second.time, ms, "game");
  assert.deepEqual(memory.kept.slice(-4), [5, 6, 7, 8]);
  assert.equal(memory.kept.length, 5);
  assert.equal(second.director.expectedLoad, 6);
  // Back on the menu with another load time expected: the build is aimed again.
  second.time.advance(1500);
  assert.deepEqual(second.sounding(), ["calm"]);
  assert.deepEqual([second.of("drama").paused, second.of("drama").volume, second.of("drama").currentTime], [true, 0, 161.2]);
  assert.equal(second.director.readyAt, 161.2);

  // A memory that cannot be read or written is no error: six seconds, learned again.
  const broken = stage({ memory: { read: () => { throw new Error("blocked"); }, write: () => { throw new Error("full"); } } });
  assert.equal(broken.director.expectedLoad, 6);
  open(broken.director, broken.time, 2000, "game");
  assert.equal(broken.director.expectedLoad, 2);
});

test("the page keeps the load times in localStorage, and does without it when it is refused", () => {
  assert.equal(LOAD_SECONDS_KEY, "audio_load_seconds");
  const held = new Map();
  const win = { localStorage: { getItem: (key) => held.get(key) ?? null, setItem: (key, value) => held.set(key, value) } };
  const memory = loadSecondsMemory(win);
  assert.deepEqual(memory.read(), []);
  memory.write([2, 3.5]);
  assert.equal(held.get("audio_load_seconds"), "[2,3.5]");
  assert.deepEqual(memory.read(), [2, 3.5]);
  held.set("audio_load_seconds", "{not json");
  assert.deepEqual(memory.read(), []);
  held.set("audio_load_seconds", "\"3\"");
  assert.deepEqual(memory.read(), []);
  const refused = loadSecondsMemory({ get localStorage() { throw new Error("denied"); } });
  assert.deepEqual(refused.read(), []);
  refused.write([1]);
  assert.ok(read("src/runtime/ambientMusic.js").includes("memory: loadSecondsMemory(win),"));
});

test("how the loading music ends: on the big hit or a later one, or, with the hit far off, a fade on the build's next accent", () => {
  // The big hit and the loud stretch's hits: never a stop before the big hit.
  assert.deepEqual([...PASSAGE_DRAMA.cuts], [168.6, 174.3, 177.6, 186.4, 193.8, 198.1, 201.55, 206.9, 214.45, 222.05]);
  assert.deepEqual([...PASSAGE_DRAMA.cuts].sort((a, b) => a - b), [...PASSAGE_DRAMA.cuts]);
  assert.equal(PASSAGE_DRAMA.cuts[0], PASSAGE_DRAMA.hit);
  assert.ok(PASSAGE_DRAMA.cuts.every((cut) => cut + PASSAGE_DRAMA.ring < PASSAGE_DRAMA.wrapAt));
  // A hit rings half a second at full, and then the music dies away over 3.2 s.
  assert.deepEqual([PASSAGE_DRAMA.ring, PASSAGE_DRAMA.stopFade], [0.5, 3200]);
  const stop = PASSAGE_DRAMA.hit + PASSAGE_DRAMA.ring;
  for (const entry of PASSAGE_DRAMA.entries) assert.ok(cutTimeAfter(entry - PASSAGE_DRAMA.lead) >= stop, `from ${entry}`);
  assert.equal(cutTimeAfter(145.3), stop);
  assert.equal(cutTimeAfter(165.2), stop);
  assert.equal(cutTimeAfter(PASSAGE_DRAMA.enter), stop);
  assert.equal(cutTimeAfter(168.8), stop, "its ring is still to come");
  assert.equal(cutTimeAfter(169.05), 174.3 + PASSAGE_DRAMA.ring);
  assert.equal(cutTimeAfter(PASSAGE_DRAMA.cuts.at(-1) + 1), PASSAGE_DRAMA.wrapAt);

  // The exception, for a guess that was badly wrong: the big hit more than 12 s away.
  assert.deepEqual([...PASSAGE_DRAMA.accents], [149.9, 157.45]);
  assert.deepEqual([PASSAGE_DRAMA.softBeyond, PASSAGE_DRAMA.softFade], [12, 1500]);
  assert.deepEqual(exitAfter(144.4), { at: 149.9, soft: true });
  assert.deepEqual(exitAfter(145.5), { at: 149.9, soft: true });
  assert.deepEqual(exitAfter(149.9), { at: 149.9, soft: true });
  assert.deepEqual(exitAfter(149.95), { at: 157.45, soft: true }, "the accent has passed: the next one");
  assert.deepEqual(exitAfter(156.5), { at: 157.45, soft: true });
  // Twelve seconds or less to the hit: it runs on to it.
  assert.deepEqual(exitAfter(156.6), { at: stop, soft: false });
  assert.deepEqual(exitAfter(157.5), { at: stop, soft: false });
  assert.deepEqual(exitAfter(160.3), { at: stop, soft: false });
  assert.deepEqual(exitAfter(165.2), { at: stop, soft: false });
  assert.deepEqual(exitAfter(170), { at: 174.3 + PASSAGE_DRAMA.ring, soft: false });
  assert.deepEqual(exitAfter(225), { at: PASSAGE_DRAMA.wrapAt, soft: false });
  // Never a long wait either way: the music has begun to end within twelve and a half seconds.
  for (let at = PASSAGE_DRAMA.entries[0] - PASSAGE_DRAMA.lead; at < PASSAGE_DRAMA.wrapAt; at += 0.05) assert.ok(exitAfter(at).at - at < 12.5, `from ${at}`);
});

test("the game is drawn: the music runs on to the big hit, lets it ring, and stops without a click", () => {
  const { director, time, of, sounding } = stage();
  director.unlock();
  director.setScene("loading");
  // Loading takes 4 seconds: the build is at 165.2 by then.
  time.advance(4000);
  const audio = of("drama");
  const drawnAt = audio.currentTime;
  near(drawnAt, 165.2, 0.011);
  director.setScene("game");
  const stop = PASSAGE_DRAMA.hit + PASSAGE_DRAMA.ring;
  assert.deepEqual([director.cutAt, director.softExit], [stop, false]);
  assert.equal(audio.paused, false, "still playing: it does not stop the moment the game is drawn");
  // Up to the hit, and into its ring; still growing louder on the way.
  time.advance((stop - drawnAt) * 1000 - 100);
  assert.equal(audio.paused, false);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  // Then it dies away over 3.2 s, fast at first and then a long tail: an
  // ending, not the piece cut off "at some point in the song".
  const full = 0.25 * PASSAGE_DRAMA.boost;
  time.advance(100 + 800);
  assert.equal(audio.paused, false);
  assert.ok(audio.volume > full * 0.45 && audio.volume < full * 0.65, `a quarter of the way: ${audio.volume}`);
  time.advance(800);
  assert.equal(audio.paused, false);
  assert.ok(audio.volume > full * 0.15 && audio.volume < full * 0.35, `half way: ${audio.volume}`);
  time.advance(1300);
  assert.equal(audio.paused, false, "still dying away after 2.9 s");
  assert.ok(audio.volume > 0 && audio.volume < full * 0.05, `almost gone: ${audio.volume}`);
  time.advance(450);
  assert.equal(audio.paused, true, "gone");
  assert.deepEqual(sounding(), []);
  assert.deepEqual([director.cutAt, director.inDrama], [null, false]);
  // No in-game piece has been chosen yet: a game is quiet.
  time.advance(10000);
  assert.deepEqual(sounding(), []);
  assert.equal(MUSIC_TRACKS.game, null);
});

test("a game that opens fast is not cut off as the music began: the build carries on under it to the big hit", () => {
  // Games open in a second here, so the build comes in at its last entry.
  const { director, time, of, sounding } = stage({ memory: remembering([1, 1, 1]) });
  director.unlock();
  time.advance(4000);
  const audio = of("drama");
  assert.equal(audio.currentTime, 164.7);
  director.setScene("loading");
  // Drawn half a second after the entry, while the menu's music is still going out.
  time.advance(1400);
  near(audio.currentTime, 164.7 + 0.5, 0.011);
  director.setScene("game");
  const stop = PASSAGE_DRAMA.hit + PASSAGE_DRAMA.ring;
  assert.deepEqual([director.cutAt, director.softExit], [stop, false]);
  // It keeps playing, all the way to the hit and its ring: three and a half more seconds.
  let heardUntil = 0;
  while (audio.currentTime < stop - 0.02) {
    time.advance(20);
    assert.equal(audio.paused, false, `still playing at ${audio.currentTime}`);
    assert.ok(audio.volume > 0.2, `and heard: ${audio.volume}`);
    heardUntil = audio.currentTime;
  }
  assert.ok(heardUntil > PASSAGE_DRAMA.hit + 0.3, `to ${heardUntil}`);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  time.advance(3400);
  assert.equal(audio.paused, true);
  assert.ok(audio.currentTime >= stop + 3 && audio.currentTime < stop + 3.5, `died away by ${audio.currentTime}`);
  assert.deepEqual(sounding(), []);
});

test("a game drawn while the big hit is still far off: the build fades out on its next accent instead", () => {
  // Games take long here, so this one came in at the start of the build.
  const { director, time, of, sounding } = stage({ memory: remembering([25, 25, 25]), tracks: { ...MUSIC_TRACKS, game: { file: "audio/in-game.mp3" } } });
  director.unlock();
  director.setScene("loading");
  time.advance(200);
  const audio = of("drama");
  near(audio.currentTime, 145.5, 0.011);
  director.setScene("atWar");
  assert.deepEqual([director.cutAt, director.softExit], [149.9, true]);
  // Up to the accent it plays on as it was.
  time.advance((149.9 - audio.currentTime) * 1000 - 50);
  assert.equal(audio.paused, false);
  const full = 0.25 * boostAt(149.85, 145.3);
  near(audio.volume, full, 0.002);
  // Then a second and a half of fading: half gone at the middle of it, never a stop.
  time.advance(50 + 750);
  assert.equal(audio.paused, false);
  near(audio.volume, full / 2, 0.02);
  time.advance(700);
  assert.equal(audio.paused, false);
  assert.ok(audio.volume > 0 && audio.volume < 0.03);
  time.advance(100);
  assert.equal(audio.paused, true);
  assert.deepEqual(sounding(), []);
  assert.deepEqual([director.cutAt, director.softExit, director.inDrama], [null, false, false]);
  assert.ok(audio.currentTime > 151.3 && audio.currentTime < 151.6, `gone by ${audio.currentTime}, long before the big hit`);
  // The breath, and then the game's own music, as after a stop.
  time.advance(1300);
  assert.deepEqual(sounding(), []);
  time.advance(400);
  assert.deepEqual(sounding(), ["game"]);
});

test("with an in-game piece, it comes in after a breath of silence", () => {
  const tracks = { ...MUSIC_TRACKS, game: { file: "audio/in-game.mp3" } };
  const { director, time, of, sounding } = stage({ tracks });
  director.unlock();
  director.setScene("loading");
  time.advance(1000);
  director.setScene("game");
  // Run to the hit, through its dying away and the breath after it.
  time.advance(14000);
  assert.equal(of("drama").paused, true);
  assert.deepEqual(sounding(), ["game"]);
  assert.equal(of("game").src, "/audio/in-game.mp3");
  time.advance(4000);
  assert.equal(of("game").volume, 0.25);
  // At war with no music of its own is whatever the game plays: nothing changes.
  const plays = of("game").plays;
  director.setScene("atWar");
  time.advance(2000);
  assert.deepEqual(sounding(), ["game"]);
  assert.equal(of("game").volume, 0.25);
  assert.equal(of("game").plays, plays);
});

test("a game still loading at the end of the loud stretch goes round it again, as loud, and never into the build", () => {
  const { director, time, of } = stage();
  director.unlock();
  director.setScene("loading");
  time.advance((PASSAGE_DRAMA.wrapAt - 161.2 + 2) * 1000);
  const audio = of("drama");
  // Back to just before the big hit: the loud stretch only, and as loud.
  assert.deepEqual([PASSAGE_DRAMA.enter, PASSAGE_DRAMA.wrapAt], [168.45, 226.4]);
  assert.ok(audio.currentTime >= PASSAGE_DRAMA.enter && audio.currentTime < PASSAGE_DRAMA.enter + 3, `went round: ${audio.currentTime}`);
  assert.equal(audio.paused, false);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  let earliest = 999;
  let latest = 0;
  for (let ms = 0; ms < 3 * 60 * 1000; ms += 20) {
    time.advance(20);
    earliest = Math.min(earliest, audio.currentTime);
    latest = Math.max(latest, audio.currentTime);
    near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  }
  assert.ok(earliest >= PASSAGE_DRAMA.enter, `never before the loud stretch: ${earliest}`);
  assert.ok(latest <= PASSAGE_DRAMA.wrapAt + 0.05, `never past it: ${latest}`);
  // Drawn at last: it stops on the next hit, as ever.
  director.setScene("game");
  assert.equal(director.cutAt, cutTimeAfter(audio.currentTime));
  assert.equal(director.softExit, false);
});

test("a build found playing the piece's opening is put back where it belongs, and one that cannot be moved is left alone", () => {
  // Some browsers do not keep where an element that has never played was told to start.
  const { director, time, of } = stage();
  director.unlock();
  time.advance(3000);
  director.setScene("loading");
  const audio = of("drama");
  audio.currentTime = 0;
  time.advance(60);
  assert.ok(audio.currentTime >= 161.2 && audio.currentTime < 161.3, `back at its entry: ${audio.currentTime}`);
  // Three times at most in one loading: after that it plays from where it is.
  for (const expected of [true, true, false]) {
    audio.currentTime = 1;
    time.advance(60);
    assert.equal(audio.currentTime > 161, expected);
  }
  assert.equal(audio.paused, false);
  // The next game opening starts the count again.
  director.setScene("menu");
  time.advance(3000);
  director.setScene("loading");
  audio.currentTime = 0;
  time.advance(60);
  assert.ok(audio.currentTime > 161);
});

test("the war room, or a battlefield shown: Legionnaire; back in the game it stops", () => {
  const { director, time, of, sounding } = stage();
  director.unlock();
  director.setScene("game");
  time.advance(3000);
  assert.deepEqual(sounding(), [], "the menu's music has faded");
  director.setScene("war");
  time.advance(1500);
  assert.deepEqual(sounding(), ["war"]);
  assert.equal(of("war").src, "/audio/legionnaire.mp3");
  assert.equal(of("war").volume, 0.25);
  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), []);
  // And back from it into a game at war.
  director.setScene("war");
  time.advance(1500);
  director.setScene("atWar");
  time.advance(1500);
  assert.deepEqual(sounding(), []);
  // Opened while the loading music is still running to its hit: that music
  // stops now, hit or no hit.
  director.setScene("loading");
  time.advance(1000);
  director.setScene("game");
  assert.notEqual(director.cutAt, null);
  director.setScene("war");
  assert.equal(director.cutAt, null);
  // It does not wait for a hit: it goes out as Legionnaire comes in.
  time.advance(1000);
  assert.equal(of("drama").paused, true, "at once");
  time.advance(500);
  assert.deepEqual(sounding(), ["war"]);
  // Opened straight from a game still opening, in the middle of the crossing: both elements stop.
  director.setScene("menu");
  time.advance(4000);
  director.setScene("loading");
  time.advance(900);
  assert.deepEqual(sounding(), ["calm", "drama"]);
  director.setScene("war");
  time.advance(1000);
  assert.deepEqual([of("calm").paused, of("drama").paused], [true, true]);
  assert.equal(director.inDrama, false);
  time.advance(500);
  assert.deepEqual(sounding(), ["war"]);
  // And the menu takes over from anything.
  director.setScene("menu");
  time.advance(3000);
  assert.deepEqual(sounding(), ["calm"]);
  assert.ok(of("calm").currentTime < 5);
});

test("the war room's music is a list of the game's own: Legionnaire, then Vanguard, then Legionnaire again", () => {
  assert.deepEqual([...MUSIC_WAR_PIECES], ["war", "vanguard"]);
  assert.deepEqual(MUSIC_WAR_PIECES.map((name) => MUSIC_TRACKS[name].file), ["audio/legionnaire.mp3", "audio/vanguard.mp3"]);
  const lengths = { "/audio/legionnaire.mp3": 190, "/audio/vanguard.mp3": 235 };
  const { director, made, time, of, sounding } = stage({ lengths });
  director.unlock();
  director.setScene("game");
  time.advance(3000);
  director.setScene("war");
  time.advance(1500);
  // A session starts on Legionnaire, and nothing of Vanguard has been asked for.
  assert.deepEqual(sounding(), ["war"]);
  const audio = of("war");
  assert.deepEqual([audio.src, audio.loop, audio.preload, audio.volume], ["/audio/legionnaire.mp3", false, "none", 0.25]);
  assert.equal(audio.loads, 1);
  assert.ok(!made.some((element) => element.src === "/audio/vanguard.mp3"), "only the piece about to play has been requested");
  // Up to the last second of Legionnaire: still only that file.
  time.advance(187000);
  assert.equal(audio.src, "/audio/legionnaire.mp3");
  assert.equal(audio.loads, 1);
  // It ends: Vanguard, at once and at the same level.
  time.advance(2500);
  assert.equal(audio.src, "/audio/vanguard.mp3");
  assert.deepEqual([audio.paused, audio.volume, audio.loads], [false, 0.25, 2]);
  assert.ok(audio.currentTime < 2);
  // Leaving the war room fades it out where it is, and coming back carries on with the piece it was on.
  time.advance(60000);
  const leftAt = audio.currentTime;
  director.setScene("atWar");
  time.advance(400);
  assert.ok(audio.volume > 0 && audio.volume < 0.25, "fading, not cut");
  time.advance(1100);
  assert.deepEqual(sounding(), [], "at war outside the war room is the game's music, not the war pieces");
  assert.equal(audio.paused, true);
  time.advance(30000);
  director.setScene("war");
  time.advance(1500);
  assert.deepEqual(sounding(), ["war"]);
  assert.equal(audio.src, "/audio/vanguard.mp3");
  near(audio.currentTime, leftAt + 0.9 + 1.5, 0.05);
  assert.equal(audio.loads, 2, "the same file, not asked for again");
  // Vanguard ends: round again, Legionnaire from its start.
  time.advance((235 - audio.currentTime) * 1000 + 500);
  assert.equal(audio.src, "/audio/legionnaire.mp3");
  assert.equal(audio.paused, false);
  assert.ok(audio.currentTime < 1);
  assert.equal(made.filter((element) => /legionnaire|vanguard/.test(element.src)).length, 1, "one element for the two pieces");
  // The menu and a new game do not start it over: the list is the session's.
  director.setScene("menu");
  time.advance(3000);
  director.setScene("war");
  time.advance(1500);
  assert.equal(audio.src, "/audio/legionnaire.mp3");
  assert.ok(audio.currentTime > 1);
});

test("a war piece that cannot be played is passed over; with neither, the war room is silent and nothing breaks", async () => {
  const one = stage({ broken: ["/audio/legionnaire.mp3"] });
  one.director.unlock();
  one.director.setScene("war");
  await settle();
  one.time.advance(1500);
  assert.deepEqual(one.sounding(), ["war"]);
  assert.equal(one.of("war").src, "/audio/vanguard.mp3");
  const neither = stage({ broken: ["/audio/legionnaire.mp3", "/audio/vanguard.mp3"] });
  neither.director.unlock();
  neither.director.setScene("war");
  await settle();
  await settle();
  neither.time.advance(3000);
  assert.deepEqual(neither.sounding(), []);
  assert.equal(neither.of("war").plays, 2, "each was tried once, and then it is left alone");
  neither.director.setScene("game");
  neither.director.setScene("war");
  neither.time.advance(1500);
  assert.equal(neither.of("war").plays, 2);
  assert.deepEqual(neither.sounding(), []);
});

test("switched off, it downloads nothing; the switch, the volume and a hidden page are followed at once", () => {
  const off = stage({ enabled: false });
  off.director.unlock();
  off.time.advance(3000);
  assert.equal(off.made.length, 0, "on the menu with the music off, not even the build is made ready");
  off.director.setScene("loading");
  off.director.setScene("game");
  off.director.setScene("war");
  off.time.advance(5000);
  assert.equal(off.made.length, 0);
  // Turned on in the war room: that scene's piece, and only that one.
  off.settings.enabled = true;
  off.director.sync();
  assert.deepEqual(off.sounding(), ["war"]);
  assert.equal(off.made.length, 1);

  const on = stage({ volume: 50 });
  on.director.unlock();
  on.time.advance(3000);
  // The opening is turned up by the levelling: 50% times 1.6.
  near(on.of("calm").volume, 0.8, 1e-9);
  on.settings.volume = 10;
  on.director.sync();
  near(on.of("calm").volume, 0.16, 1e-9);
  assert.equal(on.of("calm").plays, 1, "a change of volume does not start it again");
  // Never past full volume, whatever the levelling asks.
  on.settings.volume = 80;
  on.director.sync();
  assert.equal(on.of("calm").volume, 1);
  on.settings.volume = 0;
  on.director.sync();
  assert.equal(on.of("calm").paused, true);
  on.settings.volume = 40;
  on.director.sync();
  assert.equal(on.of("calm").paused, false);
  on.director.setHidden(true);
  assert.equal(on.of("calm").paused, true);
  on.director.setHidden(false);
  assert.equal(on.of("calm").paused, false);
  // While something else is listened to (a track tried out in the editor) it waits, and carries on after.
  on.director.setHeld(true);
  assert.equal(on.of("calm").paused, true);
  on.director.setHeld(false);
  assert.equal(on.of("calm").paused, false);
  // The build held ready stayed silent and still through all of it.
  assert.deepEqual([on.of("drama").paused, on.of("drama").plays, on.of("drama").volume, on.of("drama").currentTime], [true, 0, 0, 161.2]);

  // A hidden page pauses both elements in the middle of their crossing, and both carry on after.
  on.director.setScene("loading");
  on.time.advance(900);
  assert.deepEqual(on.sounding(), ["calm", "drama"]);
  on.director.setHidden(true);
  assert.deepEqual([on.of("calm").paused, on.of("drama").paused], [true, true]);
  on.time.advance(100);
  on.director.setHidden(false);
  assert.deepEqual([on.of("calm").paused, on.of("drama").paused], [false, false]);
  near(on.of("drama").currentTime, 161.2, 0.011);
  // The loud stretch never goes past full volume.
  on.settings.volume = 80;
  on.director.sync();
  on.time.advance(1100);
  assert.deepEqual(on.sounding(), ["drama"]);
  assert.ok(on.of("drama").volume > 0.79 && on.of("drama").volume < 0.9, `little louder than the player's volume near the entry: ${on.of("drama").volume}`);
  on.time.advance(8000);
  assert.equal(on.of("drama").volume, 1);
});

test("a game opened before the first click starts in the right place at that click", () => {
  const loading = stage();
  loading.director.setScene("loading");
  assert.equal(loading.made.length, 0);
  loading.director.unlock();
  // The build could not be made ready, and there is no menu music to cross
  // with: it comes in from the entry itself, over the same 1.8 seconds.
  assert.equal(loading.made.length, 1);
  assert.deepEqual([loading.of("drama").currentTime, loading.of("drama").volume, loading.of("drama").paused], [161.2, 0, false]);
  loading.time.advance(300);
  near(loading.of("drama").currentTime, 161.2 + 0.3, 0.011);
  assert.equal(loading.director.inDrama, true);
  assert.ok(loading.of("drama").volume > 0.03 && loading.of("drama").volume < 0.1, `coming in: ${loading.of("drama").volume}`);
  loading.time.advance(1550);
  near(loading.of("drama").volume, 0.25 * boostAt(loading.of("drama").currentTime, 161.2), 0.002);
  assert.deepEqual(loading.sounding(), ["drama"]);
  assert.equal(loading.of("calm"), null, "the menu's element was never needed");
  // A click late in the loading: the entry is for what is left of it. 5.5 of
  // the expected 6 seconds are gone, and the last entry is the latest there is.
  const lateClick = stage();
  lateClick.director.setScene("loading");
  lateClick.time.advance(5500);
  lateClick.director.unlock();
  lateClick.time.advance(100);
  near(lateClick.of("drama").currentTime, 164.7 + 0.1, 0.011);
  // Already in the game by the first click: no loading music at all.
  const late = stage();
  late.director.setScene("loading");
  late.director.setScene("game");
  late.director.unlock();
  late.time.advance(3000);
  assert.deepEqual(late.sounding(), []);
  assert.equal(late.made.length, 0);
});

test("a browser that still refuses is asked again at the next click; a file that cannot play is left alone", async () => {
  const refused = stage({ refuse: "NotAllowedError" });
  refused.director.unlock();
  await settle();
  assert.equal(refused.director.unlocked, false);
  refused.director.unlock();
  assert.equal(refused.of("calm").plays, 2);
  const broken = stage({ refuse: "NotSupportedError" });
  broken.director.unlock();
  await settle();
  assert.equal(broken.director.unlocked, true);
});

test("the scene is where the player is", () => {
  assert.deepEqual([...MUSIC_SCENES], ["menu", "loading", "game", "atWar", "war"]);
  assert.equal(musicSceneOf({ inMenu: true, loading: true, atWar: true, war: true }), "menu");
  assert.equal(musicSceneOf({ loading: true, atWar: true, war: true }), "loading");
  assert.equal(musicSceneOf({ atWar: true, war: true }), "war");
  assert.equal(musicSceneOf({ war: true }), "war");
  assert.equal(musicSceneOf({ atWar: true }), "atWar");
  assert.equal(musicSceneOf({}), "game");
  const screen = read("src/Game/GameUI/main.jsx");
  assert.ok(screen.includes("const battlefieldShown = useWarRoom((room) => room.open || Boolean(room.battlefield));"));
  // At war is what puts the war room's button on the screen: the player's troops on a battlefield.
  assert.ok(screen.includes("const atWar = Boolean(warFronts) && isActiveFeatureEnabled(\"fronts\");"));
  assert.ok(screen.includes("musicSceneOf({ inMenu: mainMenuOpen || hasNoGames, loading: showGameLoading, atWar, war: battlefieldShown })"));
  assert.ok(screen.includes("useEffect(() => { setMusicScene(musicScene); }, [musicScene]);"));
  // The open game's scenario's own music, told before the scene it is for.
  assert.ok(screen.includes("const scenarioMusicKey = JSON.stringify((activeGame?.id && runtimeScenario?.music) || null);"));
  assert.ok(screen.includes("useEffect(() => { followScenarioMusic(JSON.parse(scenarioMusicKey)); }, [scenarioMusicKey]);"));
  assert.ok(screen.indexOf("followScenarioMusic(JSON.parse(scenarioMusicKey))") < screen.indexOf("setMusicScene(musicScene)"));
  // Started once, for every build, where the page starts; and no page, no music, no error.
  assert.ok(read("src/main.jsx").includes("startMusic({ env: import.meta.env });"));
  assert.equal(startMusic({ win: null, doc: null }), null);
  setMusicScene("war");
  setMusicPlaylists({ game: [hubTrack("a")] });
  holdMusic(true);
  assert.equal(getNowPlaying(), null);
  assert.equal(typeof subscribeNowPlaying(() => {}), "function");
});

test("the stored volume is a whole number from 0 to 100, and the default when it is not one", () => {
  assert.equal(musicVolumeOf("40"), 40);
  assert.equal(musicVolumeOf("0"), 0);
  assert.equal(musicVolumeOf("250"), 100);
  assert.equal(musicVolumeOf("-3"), 0);
  assert.equal(musicVolumeOf("12.6"), 13);
  for (const none of ["", null, undefined, "loud", "NaN"]) assert.equal(musicVolumeOf(none), DEFAULT_MUSIC_VOLUME);
});

test("the files are the game's own, beside the page in every build", () => {
  assert.equal(musicAddress("audio/x.mp3", "/"), "/audio/x.mp3");
  assert.equal(musicAddress("audio/x.mp3", "/play/"), "/play/audio/x.mp3");
  assert.equal(musicAddress("audio/x.mp3", "./"), "./audio/x.mp3");
  assert.equal(musicAddress("audio/x.mp3", undefined), "/audio/x.mp3");
  for (const track of Object.values(MUSIC_TRACKS).filter(Boolean)) {
    const file = path.join(root, "public", track.file);
    assert.ok(fs.existsSync(file), track.file);
    // An MP3, by its first bytes: an ID3 tag, or a frame.
    const head = fs.readFileSync(file).subarray(0, 3);
    assert.ok(head.toString("latin1") === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0), track.file);
  }
});

test("it is on unless the player turns it off, and Settings says whose music it is", () => {
  const settings = read("src/Game/GameUI/settings.jsx");
  assert.ok(settings.includes("ambientMusic: getMapSettingDefaultOn(MAP_SETTING_KEYS.ambientMusic),"));
  assert.ok(read("src/runtime/ambientMusic.js").includes("export const musicEnabled = () => getMapSettingDefaultOn(MAP_SETTING_KEYS.ambientMusic);"));
  assert.equal(typeof MAP_SETTING_KEYS.ambientMusic, "string");
  assert.equal(typeof MAP_SETTING_KEYS.musicVolume, "string");
  // The licence's condition: the titles, the author, the licence, and where they are from.
  assert.ok(settings.includes("{\"Music: “Passage Of Time”, “Legionnaire (2022 Remaster)” and “Vanguard” by Scott Buckley, released under CC BY 4.0.\"}"));
  assert.ok(!settings.includes("“Passage Of Time” and “Legionnaire (2022 Remaster)” by"), "the two-piece sentence is gone");
  assert.ok(settings.includes("href={MUSIC_CREDIT.siteUrl}"));
  assert.deepEqual([MUSIC_CREDIT.artist, MUSIC_CREDIT.licence, MUSIC_CREDIT.site], ["Scott Buckley", "CC BY 4.0", "www.scottbuckley.com.au"]);
  // Every piece has its composer's name for it, and the sentence names each of them.
  assert.deepEqual([MUSIC_TRACKS.passage.work, MUSIC_TRACKS.war.work, MUSIC_TRACKS.vanguard.work], ["Passage Of Time", "Legionnaire (2022 Remaster)", "Vanguard"]);
  const pieces = Object.values(MUSIC_TRACKS).filter(Boolean);
  assert.equal(pieces.length, 3);
  for (const piece of pieces) {
    assert.ok(settings.includes(`“${piece.work}”`), piece.work);
    assert.deepEqual([piece.artist, piece.licence], ["Scott Buckley", "CC BY 4.0"]);
  }
  const credits = read("public/audio/CREDITS.txt");
  for (const part of ["Passage Of Time", "Legionnaire (2022 Remaster)", "Vanguard", "Scott Buckley", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", "scottbuckley.com.au"]) assert.ok(credits.includes(part), part);
  // Each file by its name, its piece, where it is from, and where it plays.
  const literally = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const piece of pieces) {
    assert.match(credits, new RegExp(`${literally(path.basename(piece.file))}\\r?\\n {4}"${literally(piece.work)}" by Scott Buckley\\r?\\n {4}https://www\\.scottbuckley\\.com\\.au/library/`), piece.file);
  }
  assert.match(credits, /vanguard\.mp3\r?\n {4}"Vanguard" by Scott Buckley\r?\n {4}https:\/\/www\.scottbuckley\.com\.au\/library\/vanguard\/\r?\n {4}Plays in the war room and while a battlefield is shown\./);
  const readme = read("README.md");
  assert.ok(readme.includes("\"Passage Of Time\", \"Legionnaire (2022 Remaster)\" and \"Vanguard\", all released under [CC BY 4.0]"));
  // A scenario's own track is the hub's, and its licence asks the same: the
  // one sounding is credited in the hub's words, which are never translated,
  // with where it is from.
  assert.ok(settings.includes("const nowPlaying = useSyncExternalStore(subscribeNowPlaying, getNowPlaying, getNowPlaying);"));
  assert.ok(settings.includes("<span>{\"Now playing:\"}</span>"));
  assert.ok(settings.includes("<span data-no-translate>{nowPlaying.credit}</span>"));
  assert.ok(settings.includes("<a data-no-translate href={nowPlaying.source} target=\"_blank\" rel=\"noopener noreferrer\""));
});

// ---- a scenario's own lists ------------------------------------------------------

test("a scenario's list plays in the place of the game's piece: in order, the next when one ends, round again", () => {
  const said = [];
  const lengths = { "/hub/a.mp3": 30, "/hub/b.mp3": 20, "/hub/c.mp3": 10 };
  const { director, made, time, list, sounding } = stage({ lengths, onNowPlaying: (track) => said.push(track?.id ?? null) });
  director.setPlaylists({ game: [hubTrack("a"), hubTrack("b"), hubTrack("c")] });
  director.unlock();
  time.advance(2000);
  // The menu is never a scenario's.
  assert.deepEqual(sounding(), ["calm"]);
  assert.ok(made.every((element) => element.src === "/audio/passage-of-time.mp3"), "and none of the scenario's files has been asked for");
  assert.deepEqual(said, []);

  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);
  const audio = list("game").audio;
  assert.deepEqual([audio.src, audio.loop, audio.preload, audio.volume], ["/hub/a.mp3", false, "none", 0.25]);
  assert.equal(audio.loads, 1, "only the track that is playing has been asked for");
  assert.deepEqual(said, ["a"]);
  // It ends: the next, at once and at the list's level.
  time.advance(29000);
  assert.equal(audio.src, "/hub/b.mp3");
  assert.deepEqual([audio.paused, audio.volume], [false, 0.25]);
  assert.ok(audio.currentTime < 1);
  time.advance(20000);
  assert.equal(audio.src, "/hub/c.mp3");
  // Round again at the end.
  time.advance(10000);
  assert.equal(audio.src, "/hub/a.mp3");
  assert.equal(audio.paused, false);
  assert.deepEqual(said, ["a", "b", "c", "a"]);
  assert.equal(made.filter((element) => element.src.startsWith("/hub/")).length, 1, "one element for the list, whatever its length");
  assert.equal(director.nowPlaying.id, "a");

  // One track alone goes round by itself.
  const alone = stage({ lengths: { "/hub/a.mp3": 5 } });
  alone.director.setPlaylists({ game: [hubTrack("a")] });
  alone.director.unlock();
  alone.director.setScene("game");
  alone.time.advance(12500);
  assert.equal(alone.list("game").audio.paused, false);
  near(alone.list("game").audio.currentTime, 2.5, 0.02);
  assert.equal(alone.list("game").audio.loads, 1, "the same file, not asked for again");
});

test("leaving a situation fades its list out where it is, and coming back carries on from there", () => {
  const { director, time, of, list, sounding } = stage({ lengths: { "/hub/a.mp3": 30, "/hub/b.mp3": 600 } });
  director.setPlaylists({ game: [hubTrack("a"), hubTrack("b")] });
  director.unlock();
  director.setScene("game");
  // Into the second track.
  time.advance(40000);
  const audio = list("game").audio;
  assert.equal(audio.src, "/hub/b.mp3");
  const leftAt = audio.currentTime;
  // The war room: Legionnaire, since the scenario has nothing for it.
  director.setScene("war");
  time.advance(400);
  assert.ok(audio.volume > 0 && audio.volume < 0.25, "fading, not cut");
  time.advance(1100);
  assert.deepEqual(sounding(), ["war"]);
  assert.equal(audio.paused, true);
  near(audio.currentTime, leftAt + 0.9, 0.05);
  time.advance(60000);
  // Back in the game: the same track, from where it was.
  const heldAt = audio.currentTime;
  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);
  assert.equal(audio.src, "/hub/b.mp3");
  near(audio.currentTime, heldAt + 1.5, 0.02);
  assert.equal(of("war").paused, true);
  // The menu and back again, the same.
  director.setScene("menu");
  time.advance(3000);
  assert.deepEqual(sounding(), ["calm"]);
  const menuAt = audio.currentTime;
  director.setScene("game");
  time.advance(1500);
  assert.equal(audio.src, "/hub/b.mp3");
  near(audio.currentTime, menuAt + 1.5, 0.02);
});

test("a scenario's loading tracks replace the loading music altogether: no build, no stop on a hit", () => {
  const memory = remembering();
  const { director, time, of, list, sounding } = stage({ memory, lengths: { "/hub/intro.mp3": 400 } });
  director.setPlaylists({ loading: [hubTrack("intro")] });
  director.unlock();
  time.advance(3000);
  director.setScene("loading");
  assert.equal(director.inDrama, false);
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:loading"]);
  assert.deepEqual([of("calm").paused, of("calm").currentTime], [true, 0], "the menu's music faded out");
  assert.deepEqual([of("drama").paused, of("drama").plays], [true, 0], "and the build, held ready on the menu, was never played");
  time.advance(2500);
  // The game is drawn: it fades out, with no hit to wait for; and a game is quiet.
  director.setScene("game");
  assert.equal(director.cutAt, null);
  time.advance(450);
  assert.ok(list("loading").audio.volume > 0 && list("loading").audio.volume < 0.25);
  time.advance(600);
  assert.deepEqual(sounding(), []);
  assert.equal(list("loading").audio.paused, true);
  // The loading was timed all the same.
  assert.deepEqual(memory.kept, [4]);

  // With a list for the game too, that comes in as the loading's goes out.
  const both = stage();
  both.director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("a")] });
  both.director.unlock();
  both.director.setScene("loading");
  both.time.advance(2000);
  assert.deepEqual(both.sounding(), ["scenario:loading"]);
  both.director.setScene("game");
  both.time.advance(1500);
  assert.deepEqual(both.sounding(), ["scenario:game"]);
  // A scenario with lists but none for loading keeps the game's own loading music.
  const none = stage();
  none.director.setPlaylists({ game: [hubTrack("a")] });
  none.director.unlock();
  none.director.setScene("loading");
  none.time.advance(500);
  assert.deepEqual(none.sounding(), ["drama"]);
  assert.equal(none.director.inDrama, true);
  // And when its stop on a hit has landed and the breath is over, the game's list comes in.
  none.director.setScene("game");
  none.time.advance(14000);
  assert.deepEqual(none.sounding(), ["scenario:game"]);
});

test("at war plays its own list, or the game's when it has none; the war room plays the scenario's battle list", () => {
  const lists = { game: [hubTrack("a")], atWar: [hubTrack("w")], battle: [hubTrack("b")] };
  const { director, time, of, list, sounding } = stage();
  director.setPlaylists(lists);
  director.unlock();
  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);
  director.setScene("atWar");
  time.advance(450);
  assert.deepEqual(sounding(), ["scenario:game", "scenario:atWar"], "one fades into the other");
  time.advance(1050);
  assert.deepEqual(sounding(), ["scenario:atWar"]);
  assert.equal(list("atWar").audio.src, "/hub/w.mp3");
  // The war room or a battlefield shown: the battle list, not Legionnaire.
  director.setScene("war");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:battle"]);
  assert.equal(of("war"), null, "Legionnaire was never asked for");
  director.setScene("atWar");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:atWar"]);
  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);

  // No list for at war: the game's list goes on, untouched.
  const plain = stage();
  plain.director.setPlaylists({ game: [hubTrack("a")] });
  plain.director.unlock();
  plain.director.setScene("game");
  plain.time.advance(5000);
  const audio = plain.list("game").audio;
  const [plays, pauses] = [audio.plays, audio.pauses];
  plain.director.setScene("atWar");
  plain.time.advance(2000);
  assert.deepEqual(plain.sounding(), ["scenario:game"]);
  assert.deepEqual([audio.volume, audio.plays, audio.pauses], [0.25, plays, pauses]);
  near(audio.currentTime, 7, 0.02);
  assert.equal(plain.list("atWar").audio, null);
  // And no battle list: Legionnaire, as in any game.
  plain.director.setScene("war");
  plain.time.advance(1500);
  assert.deepEqual(plain.sounding(), ["war"]);
  // Only an at-war list: a game at peace is as quiet as any, and at war it plays.
  const onlyWar = stage();
  onlyWar.director.setPlaylists({ atWar: [hubTrack("w")] });
  onlyWar.director.unlock();
  onlyWar.director.setScene("game");
  onlyWar.time.advance(3000);
  assert.deepEqual(onlyWar.sounding(), []);
  onlyWar.director.setScene("atWar");
  onlyWar.time.advance(1500);
  assert.deepEqual(onlyWar.sounding(), ["scenario:atWar"]);
  onlyWar.director.setScene("game");
  onlyWar.time.advance(1500);
  assert.deepEqual(onlyWar.sounding(), []);
});

test("a track that cannot be played is passed over; a list none of whose tracks can gives way to the game's own piece", async () => {
  // The second of three cannot be played.
  const skipping = stage({ lengths: { "/hub/a.mp3": 10, "/hub/c.mp3": 10 }, broken: ["/hub/b.mp3"] });
  skipping.director.setPlaylists({ game: [hubTrack("a"), hubTrack("b"), hubTrack("c")] });
  skipping.director.unlock();
  skipping.director.setScene("game");
  skipping.time.advance(10500);
  await settle();
  assert.equal(skipping.list("game").audio.src, "/hub/c.mp3", "straight on to the third");
  assert.equal(skipping.list("game").audio.paused, false);
  assert.equal(skipping.list("game").dead, false);
  skipping.time.advance(10000);
  await settle();
  assert.equal(skipping.list("game").audio.src, "/hub/a.mp3");
  assert.deepEqual(skipping.sounding(), ["scenario:game"]);

  // None of the battle list can be played: Legionnaire, as if the scenario had none.
  const said = [];
  const dead = stage({ broken: ["/hub/x.mp3", "/hub/y.mp3"], onNowPlaying: (track) => said.push(track?.id ?? null) });
  dead.director.setPlaylists({ battle: [hubTrack("x"), hubTrack("y"), hubTrack("x")], game: [hubTrack("a")] });
  dead.director.unlock();
  dead.director.setScene("war");
  await settle();
  await settle();
  assert.equal(dead.list("battle").dead, true);
  assert.equal(dead.list("battle").audio.plays, 3, "each was tried once");
  dead.time.advance(1500);
  assert.deepEqual(dead.sounding(), ["war"]);
  assert.equal(dead.of("war").src, "/audio/legionnaire.mp3");
  assert.equal(said.at(-1) ?? null, null, "and nothing of the hub's is said to be playing");
  // The rest of the scenario's music is untouched.
  dead.director.setScene("game");
  dead.time.advance(1500);
  assert.deepEqual(dead.sounding(), ["scenario:game"]);
  // Left alone until the player has been back to the menu, then tried again.
  dead.director.setScene("war");
  dead.time.advance(1500);
  assert.deepEqual(dead.sounding(), ["war"]);
  assert.equal(dead.list("battle").audio.plays, 3);
  dead.director.setScene("menu");
  assert.equal(dead.list("battle").dead, false);

  // A loading list that cannot be played: the game's own loading music, at its entry.
  const loading = stage({ broken: ["/hub/intro.mp3"] });
  loading.director.setPlaylists({ loading: [hubTrack("intro")] });
  loading.director.unlock();
  loading.director.setScene("loading");
  await settle();
  loading.time.advance(700);
  assert.deepEqual(loading.sounding(), ["drama"]);
  assert.equal(loading.director.inDrama, true);
  assert.ok(loading.of("drama").currentTime > 161 && loading.of("drama").currentTime < 163);
  // At war, with its own list unplayable: the game's list.
  const war = stage({ broken: ["/hub/w.mp3"] });
  war.director.setPlaylists({ game: [hubTrack("a")], atWar: [hubTrack("w")] });
  war.director.unlock();
  war.director.setScene("atWar");
  await settle();
  war.time.advance(1500);
  assert.deepEqual(war.sounding(), ["scenario:game"]);
});

test("a scenario's music is asked for only when it is about to play, and never while the music is off", () => {
  const off = stage({ enabled: false });
  off.director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("a")], atWar: [hubTrack("w")], battle: [hubTrack("b")] });
  off.director.unlock();
  for (const scene of ["loading", "game", "atWar", "war"]) {
    off.director.setScene(scene);
    off.time.advance(3000);
  }
  assert.equal(off.made.length, 0, "no element, so no request for any file");
  // Turned on in the war room: its list, and only that.
  off.settings.enabled = true;
  off.director.sync();
  assert.equal(off.made.length, 1);
  assert.equal(off.list("battle").audio.src, "/hub/b.mp3");
  assert.equal(off.list("battle").audio.preload, "none");
  // A hidden page, and a track being tried out elsewhere: it waits and carries on.
  off.time.advance(1500);
  off.director.setHidden(true);
  assert.equal(off.list("battle").audio.paused, true);
  off.director.setHidden(false);
  assert.equal(off.list("battle").audio.paused, false);
  off.director.setHeld(true);
  assert.equal(off.list("battle").audio.paused, true);
  off.director.setHeld(false);
  assert.equal(off.list("battle").audio.paused, false);
  // The volume is followed.
  off.settings.volume = 80;
  off.director.sync();
  assert.equal(off.list("battle").audio.volume, 0.8);
  // Before the first click nothing is made either.
  const waiting = stage();
  waiting.director.setPlaylists({ game: [hubTrack("a")] });
  waiting.director.setScene("game");
  waiting.time.advance(3000);
  assert.equal(waiting.made.length, 0);
  waiting.director.unlock();
  waiting.time.advance(1500);
  assert.deepEqual(waiting.sounding(), ["scenario:game"]);
});

test("the lists can arrive, change and go while a game is open", () => {
  const said = [];
  const { director, time, of, list, sounding } = stage({ onNowPlaying: (track) => said.push(track?.id ?? null) });
  director.unlock();
  // The hub's list was not known when the game began to open: the game's own
  // loading music started, and gives way when the scenario's arrives.
  director.setScene("loading");
  time.advance(1000);
  assert.deepEqual(sounding(), ["drama"]);
  director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("a"), hubTrack("b")] });
  assert.equal(director.inDrama, false);
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:loading"]);
  assert.equal(of("drama").paused, true);
  director.setScene("game");
  time.advance(5000);
  assert.deepEqual(sounding(), ["scenario:game"]);
  const audio = list("game").audio;
  const at = audio.currentTime;
  // The same lists again (the hub's list was read afresh): nothing starts over.
  director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("a"), hubTrack("b")] });
  time.advance(1000);
  near(audio.currentTime, at + 1, 0.02);
  assert.deepEqual([audio.src, audio.volume, audio.plays], ["/hub/a.mp3", 0.25, 1]);
  // The hub took the first track down: the list is what is left of it.
  director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("b")] });
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);
  assert.equal(audio.src, "/hub/b.mp3");
  assert.equal(said.at(-1), "b");
  // Another game, whose scenario has no music: the game's own (none in a game).
  director.setPlaylists(null);
  time.advance(1500);
  assert.deepEqual(sounding(), []);
  assert.equal(audio.paused, true);
  assert.equal(said.at(-1), null);
  assert.equal(director.nowPlaying, null);
  // Entries with no address to play from are not tracks.
  director.setPlaylists({ game: [{ id: "x", src: "" }, null, { id: "y" }] });
  time.advance(1500);
  assert.deepEqual(sounding(), []);
  assert.equal(list("game").tracks.length, 0);
});
