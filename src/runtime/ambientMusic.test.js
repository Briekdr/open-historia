/*! Open Historia — the game's music: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/ambientMusic.test.js
//
// "Add this as ambient music in game." "Make this song play in loading screen
// then become super dramatic when you start a game and its loading then it
// dramatically stops the music at certain points in the song and a different
// song plays ingame." "When in the war room or looking at a battlefield it
// should play this." "Make it not be as dramatic when idle in the main menu
// and ramp up dramaticism when loading." "Scenario creators should be able to
// add different tracks and songs for different situations."
//
// What is pinned: which piece sounds in which scene; that the menu never
// leaves the quiet opening; where a game opening comes into the build, from
// how long games take to open here, and how its loudness grows; the stop on a
// hit; a scenario's lists in the place of the game's own pieces, track after
// track, and the game's own piece back when none of a list can be played; that
// a file is only asked for when it is about to play; and that Settings says
// whose music it is, which is what the pieces' licence (CC BY 4.0) asks for.

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
  createMusicDirector,
  cutTimeAfter,
  entryFor,
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

test("the menu: nothing is made or fetched before the first click, then Passage Of Time from its start, quietly", () => {
  const { director, made, time, of, sounding } = stage();
  director.sync();
  director.setHidden(false);
  time.advance(2000);
  assert.equal(made.length, 0, "no element, so no request for a file");
  director.unlock();
  assert.equal(made.length, 1, "only the piece that is about to play");
  const audio = of("passage");
  assert.deepEqual([audio.src, audio.loop, audio.preload, audio.paused], ["/audio/passage-of-time.mp3", true, "none", false]);
  time.advance(2000);
  assert.deepEqual(sounding(), ["passage"]);
  assert.equal(audio.volume, 0.25);
  assert.ok(audio.currentTime < 5, "from the quiet opening");
  // A second click does not start it again.
  director.unlock();
  assert.equal(audio.plays, 1);
});

test("the menu stays calm: only the quiet opening, faded out before the piece rises and started again", () => {
  assert.deepEqual({ ...PASSAGE_CALM }, { fadeFrom: 63, end: 66, fadeIn: 2500 });
  assert.ok(Object.isFrozen(PASSAGE_CALM));
  const { director, time, of } = stage();
  director.unlock();
  const audio = of("passage");
  // At full (quiet) volume up to where the fade begins.
  time.advance(62500);
  near(audio.currentTime, 62.5, 0.02);
  assert.equal(audio.volume, 0.25);
  // Halfway through the fade it is at half; by its end it is silent.
  time.advance(2000);
  near(audio.currentTime, 64.5, 0.02);
  near(audio.volume, 0.125, 0.005);
  time.advance(1450);
  assert.ok(audio.volume < 0.01, `nearly silent at ${audio.currentTime}: ${audio.volume}`);
  assert.ok(audio.currentTime < PASSAGE_CALM.end);
  // From the top again, coming back in over two and a half seconds.
  time.advance(100);
  assert.ok(audio.currentTime < 0.2, `started again: ${audio.currentTime}`);
  assert.ok(audio.volume < 0.02, "from silence");
  assert.equal(audio.paused, false);
  const startedAgain = time.now - audio.currentTime * 1000;
  time.advance(startedAgain + 1250 - time.now);
  near(audio.volume, 0.125, 0.006);
  time.advance(1300);
  assert.equal(audio.volume, 0.25);
  assert.equal(audio.plays, 1, "the same element, never started twice");

  // Left idling for minutes it never passes the end of the opening (66.0; the
  // piece starts to rise at 67.4), goes silent every time, and goes round.
  let latest = 0;
  let rounds = 0;
  let before = audio.currentTime;
  for (let ms = 0; ms < 6 * 60 * 1000; ms += 5) {
    time.advance(5);
    latest = Math.max(latest, audio.currentTime);
    if (audio.currentTime < before) {
      rounds += 1;
      assert.equal(audio.volume, 0, "silent as it goes back to the start");
    }
    before = audio.currentTime;
  }
  assert.ok(latest <= PASSAGE_CALM.end, `never past the end of the quiet opening: ${latest}`);
  assert.ok(latest > PASSAGE_CALM.end - 0.05, `and played right up to it: ${latest}`);
  assert.ok(rounds >= 5, `${rounds} rounds`);
  assert.equal(audio.paused, false);
  assert.equal(director.inDrama, false);
});

test("the menu is watched slowly, and the watch sees a changed volume through the fade", () => {
  const { director, settings, time, of } = stage();
  director.unlock();
  time.advance(5000);
  // A look about every 200 ms, not every 25: under 6 a second.
  const before = time.asked;
  time.advance(50000);
  assert.ok(time.asked - before < 300, `${time.asked - before} timers in 50 seconds`);
  assert.ok(time.asked - before > 200);
  // The volume slider moved while the opening dies away: followed at once, at the fade's level.
  time.advance(9500);
  near(of("passage").currentTime, 64.5, 0.02);
  settings.volume = 50;
  director.sync();
  near(of("passage").volume, 0.25, 0.01);
});

test("where a game opening comes into the build: the latest phrase that still leaves the game time to be drawn", () => {
  // Phrase starts, each just before an accent, with their lead to the big hit.
  assert.deepEqual([...PASSAGE_DRAMA.entries], [145.3, 149.75, 157.3, 161.2, 164.7, 166.9, 168.45]);
  assert.equal(PASSAGE_DRAMA.hit, 168.6);
  assert.deepEqual(PASSAGE_DRAMA.entries.map((entry) => Math.round((PASSAGE_DRAMA.hit - entry) * 100) / 100), [23.3, 18.85, 11.3, 7.4, 3.9, 1.7, 0.15]);
  for (const [expected, entry] of [[1, 166.9], [3, 164.7], [6, 161.2], [10, 157.3], [15, 149.75], [20, 145.3], [35, 145.3], [400, 145.3]]) {
    assert.equal(entryFor(expected), entry, `a game expected to take ${expected} s`);
  }
  // The lead is the load time and half a second: exactly enough is enough.
  assert.equal(entryFor(1.2), 166.9);
  assert.equal(entryFor(1.21), 164.7);
  assert.equal(entryFor(3.4), 164.7);
  assert.equal(entryFor(3.41), 161.2);
  // Nothing is known of the load: as six seconds.
  assert.equal(entryFor(Number.NaN), 161.2);
  assert.equal(entryFor(undefined), 161.2);
});

test("the build grows louder by where the music is: as the menu at the entry, the full boost at the big hit", () => {
  assert.equal(boostAt(161.2, 161.2), 1);
  assert.equal(boostAt(150, 161.2), 1);
  near(boostAt((161.2 + 168.6) / 2, 161.2), 1.3, 1e-9);
  near(boostAt(145.3 + (168.6 - 145.3) / 4, 145.3), 1.15, 1e-9);
  assert.equal(boostAt(168.6, 161.2), PASSAGE_DRAMA.boost);
  assert.equal(boostAt(200, 161.2), PASSAGE_DRAMA.boost);
  // Just before the hit itself: there at once, as it always was.
  assert.equal(boostAt(168.45, 168.45), 1);
  assert.equal(boostAt(168.6, 168.45), PASSAGE_DRAMA.boost);
  // No entry (the loud stretch gone round again): the full boost.
  assert.equal(boostAt(170, null), PASSAGE_DRAMA.boost);
  assert.equal(boostAt(168.45, null), PASSAGE_DRAMA.boost);
  assert.equal(PASSAGE_DRAMA.boost, 1.6);
});

test("a game opening: the menu's music dips, comes back in the build, and grows to the big hit", () => {
  const { director, time, of } = stage();
  director.unlock();
  time.advance(3000);
  const audio = of("passage");
  director.setScene("loading");
  // A short fade out of the menu's music, still in its opening.
  time.advance(200);
  near(audio.volume, 0.125, 0.02);
  assert.ok(audio.currentTime < 5);
  assert.equal(director.inDrama, false);
  time.advance(200);
  // With no game timed yet a game is expected to take six seconds: 161.20.
  near(audio.currentTime, 161.2, 0.011);
  assert.equal(director.inDrama, true);
  assert.equal(audio.paused, false);
  assert.ok(audio.volume < 0.03, "and in from silence");
  // In over about 600 ms, no louder than the menu yet.
  time.advance(600);
  near(audio.volume, 0.25 * boostAt(audio.currentTime, 161.2), 0.002);
  assert.ok(audio.volume < 0.27);
  // Halfway to the hit, halfway to the boost.
  time.advance((164.9 - audio.currentTime) * 1000);
  near(audio.currentTime, 164.9, 0.011);
  near(audio.volume, 0.25 * 1.3, 0.002);
  // At the hit and after it: the full boost.
  time.advance((168.6 - audio.currentTime) * 1000 + 30);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  time.advance(5000);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  assert.equal(audio.plays, 1);
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

  // The next session expects what the last one learned: three seconds, so 164.70.
  const second = stage({ memory });
  assert.equal(second.director.expectedLoad, 3);
  second.director.unlock();
  second.director.setScene("loading");
  second.time.advance(100);
  near(second.of("passage").currentTime, 164.7 + 0.1, 0.011);
  // Only the last five are kept.
  second.director.setScene("game");
  for (const ms of [5000, 6000, 7000, 8000]) open(second.director, second.time, ms, "game");
  assert.deepEqual(memory.kept.slice(-4), [5, 6, 7, 8]);
  assert.equal(memory.kept.length, 5);
  assert.equal(second.director.expectedLoad, 6);

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

test("the game is drawn: the music runs on to the next hit, lets it land, and stops dead", () => {
  const { director, time, of, sounding } = stage();
  director.unlock();
  director.setScene("loading");
  // Loading takes 4 seconds: the music is past the first accents by then.
  time.advance(4000);
  const audio = of("passage");
  const drawnAt = audio.currentTime;
  director.setScene("game");
  const hit = PASSAGE_DRAMA.cuts.find((cut) => cut + PASSAGE_DRAMA.ring > drawnAt + 0.1);
  assert.equal(hit, 168.6, "from 165.2 the next stop is the big hit");
  assert.equal(director.cutAt, hit + PASSAGE_DRAMA.ring);
  assert.equal(audio.paused, false, "still playing: it does not stop the moment the game is drawn");
  // Up to the hit, and a little into its ring; still growing louder on the way.
  time.advance((hit + PASSAGE_DRAMA.ring - drawnAt) * 1000 - 100);
  assert.equal(audio.paused, false);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  time.advance(400);
  assert.equal(audio.paused, true, "stopped");
  assert.deepEqual(sounding(), []);
  assert.deepEqual([director.cutAt, director.inDrama], [null, false]);
  // No in-game piece has been chosen yet: a game is quiet.
  time.advance(10000);
  assert.deepEqual(sounding(), []);
  assert.equal(MUSIC_TRACKS.game, null);
});

test("a game drawn early stops on an accent of the build, not at the big hit", () => {
  // Games take long here, so this one came in at the start of the build.
  const { director, time, of, sounding } = stage({ memory: remembering([25, 25, 25]) });
  director.unlock();
  director.setScene("loading");
  time.advance(1000);
  const audio = of("passage");
  near(audio.currentTime, 146.3, 0.011);
  director.setScene("atWar");
  assert.equal(director.cutAt, 149.9 + PASSAGE_DRAMA.ring);
  time.advance((149.9 + PASSAGE_DRAMA.ring - audio.currentTime) * 1000 - 60);
  assert.equal(audio.paused, false);
  time.advance(200);
  assert.equal(audio.paused, true, "stopped just after the accent at 149.90");
  assert.deepEqual(sounding(), []);
  assert.equal(audio.currentTime, 0, "and back at its start for the menu");
});

test("with an in-game piece, it comes in after a breath of silence", () => {
  const tracks = { ...MUSIC_TRACKS, game: { file: "audio/in-game.mp3" } };
  const { director, time, of, sounding } = stage({ tracks });
  director.unlock();
  director.setScene("loading");
  time.advance(1000);
  director.setScene("game");
  // Run to the stop.
  time.advance(10000);
  assert.equal(of("passage").paused, true);
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

test("a game still loading at the end of the loud stretch goes round it again; a stop past the last hit is at its end", () => {
  const { director, time, of } = stage();
  director.unlock();
  director.setScene("loading");
  time.advance((PASSAGE_DRAMA.wrapAt - 161.2 + 2) * 1000);
  const audio = of("passage");
  // Back to just before the big hit: the loud stretch only, never the build again, and as loud.
  assert.equal(PASSAGE_DRAMA.enter, 168.45);
  assert.ok(audio.currentTime >= PASSAGE_DRAMA.enter && audio.currentTime < PASSAGE_DRAMA.enter + 3, `went round: ${audio.currentTime}`);
  assert.equal(audio.paused, false);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  time.advance(1000 * 60);
  assert.ok(audio.currentTime >= PASSAGE_DRAMA.enter && audio.currentTime <= PASSAGE_DRAMA.wrapAt + 0.05, `and again: ${audio.currentTime}`);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  // The build's accents and the loud stretch's hits, in order, each reachable.
  assert.deepEqual([...PASSAGE_DRAMA.cuts], [149.9, 157.45, 161.35, 168.6, 174.3, 177.6, 186.4, 193.8, 198.1, 201.55, 206.9, 214.45, 222.05]);
  assert.deepEqual([...PASSAGE_DRAMA.cuts].sort((a, b) => a - b), [...PASSAGE_DRAMA.cuts]);
  assert.ok(PASSAGE_DRAMA.cuts.every((cut) => cut > PASSAGE_DRAMA.entries[0] && cut + PASSAGE_DRAMA.ring < PASSAGE_DRAMA.wrapAt));
  assert.equal(cutTimeAfter(PASSAGE_DRAMA.entries[0]), 149.9 + PASSAGE_DRAMA.ring);
  // From 161.35 on (once its ring is past reaching), the next stop is the big hit.
  assert.equal(cutTimeAfter(161.5), 161.35 + PASSAGE_DRAMA.ring);
  assert.equal(cutTimeAfter(161.6), PASSAGE_DRAMA.hit + PASSAGE_DRAMA.ring);
  assert.equal(cutTimeAfter(PASSAGE_DRAMA.enter), PASSAGE_DRAMA.hit + PASSAGE_DRAMA.ring);
  assert.equal(cutTimeAfter(PASSAGE_DRAMA.cuts.at(-1) + 1), PASSAGE_DRAMA.wrapAt);
  // Never a long wait: the music is gone within nine and a half seconds of the game being drawn.
  for (let at = PASSAGE_DRAMA.entries[0]; at < PASSAGE_DRAMA.wrapAt; at += 0.05) assert.ok(cutTimeAfter(at) - at < 9.5, `from ${at}`);
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
  // Opened while the loading music is still running to its hit: that music stops now.
  director.setScene("loading");
  time.advance(1000);
  director.setScene("game");
  assert.notEqual(director.cutAt, null);
  director.setScene("war");
  time.advance(1500);
  assert.deepEqual(sounding(), ["war"]);
  assert.equal(director.cutAt, null);
  // And the menu takes over from anything.
  director.setScene("menu");
  time.advance(2500);
  assert.deepEqual(sounding(), ["passage"]);
  assert.ok(of("passage").currentTime < 5);
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

  const on = stage({ volume: 60 });
  on.director.unlock();
  on.time.advance(2000);
  assert.equal(on.of("passage").volume, 0.6);
  on.settings.volume = 10;
  on.director.sync();
  assert.equal(on.of("passage").volume, 0.1);
  assert.equal(on.of("passage").plays, 1, "a change of volume does not start it again");
  on.settings.volume = 0;
  on.director.sync();
  assert.equal(on.of("passage").paused, true);
  on.settings.volume = 40;
  on.director.sync();
  assert.equal(on.of("passage").paused, false);
  on.director.setHidden(true);
  assert.equal(on.of("passage").paused, true);
  on.director.setHidden(false);
  assert.equal(on.of("passage").paused, false);
  // While something else is listened to (a track tried out in the editor) it waits, and carries on after.
  on.director.setHeld(true);
  assert.equal(on.of("passage").paused, true);
  on.director.setHeld(false);
  assert.equal(on.of("passage").paused, false);
  // The loud stretch never goes past full volume.
  on.settings.volume = 80;
  on.director.setScene("loading");
  on.time.advance(1000);
  assert.ok(on.of("passage").volume > 0.79 && on.of("passage").volume < 0.86, `no louder than the menu at the entry: ${on.of("passage").volume}`);
  on.time.advance(8000);
  assert.equal(on.of("passage").volume, 1);
});

test("a game opened before the first click starts in the right place at that click", () => {
  const loading = stage();
  loading.director.setScene("loading");
  assert.equal(loading.made.length, 0);
  loading.director.unlock();
  loading.time.advance(300);
  near(loading.of("passage").currentTime, 161.2 + 0.3, 0.011);
  assert.equal(loading.director.inDrama, true);
  // A click late in the loading: the entry is for what is left of it, so the
  // hit still lands as the game appears. 5.5 of the expected 6 seconds are gone.
  const lateClick = stage();
  lateClick.director.setScene("loading");
  lateClick.time.advance(5500);
  lateClick.director.unlock();
  lateClick.time.advance(100);
  near(lateClick.of("passage").currentTime, 166.9 + 0.1, 0.011);
  // Already in the game by the first click: no loading music at all.
  const late = stage();
  late.director.setScene("loading");
  late.director.setScene("game");
  late.director.unlock();
  late.time.advance(3000);
  assert.deepEqual(late.sounding(), []);
});

test("a browser that still refuses is asked again at the next click; a file that cannot play is left alone", async () => {
  const refused = stage({ refuse: "NotAllowedError" });
  refused.director.unlock();
  await settle();
  assert.equal(refused.director.unlocked, false);
  refused.director.unlock();
  assert.equal(refused.of("passage").plays, 2);
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
  assert.deepEqual(sounding(), ["passage"]);
  assert.equal(made.length, 1, "and none of the scenario's files has been asked for");
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
  assert.equal(made.length, 2, "one element for the list, whatever its length");
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
  assert.deepEqual(sounding(), ["passage"]);
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
  assert.equal(of("passage").paused, true, "the menu's music faded out");
  assert.equal(of("passage").currentTime, 0, "and never went near its build");
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
  assert.deepEqual(none.sounding(), ["passage"]);
  assert.equal(none.director.inDrama, true);
  // And when its stop on a hit has landed and the breath is over, the game's list comes in.
  none.director.setScene("game");
  none.time.advance(10000);
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
  assert.deepEqual(loading.sounding(), ["passage"]);
  assert.equal(loading.director.inDrama, true);
  assert.ok(loading.of("passage").currentTime > 161 && loading.of("passage").currentTime < 163);
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
  assert.deepEqual(sounding(), ["passage"]);
  director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("a"), hubTrack("b")] });
  assert.equal(director.inDrama, false);
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:loading"]);
  assert.equal(of("passage").currentTime, 0);
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
