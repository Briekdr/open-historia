/*! Open Historia — the game's music: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/ambientMusic.test.js
//
// "Add this as ambient music in game." "Make this song play in loading screen
// then become super dramatic when you start a game and its loading then it
// dramatically stops the music at certain points in the song and a different
// song plays ingame." "When in the war room or looking at a battlefield it
// should play this." What is pinned: which piece sounds in which scene, the
// leap into the loud stretch, the stop on a hit, that a file is only asked for
// when it is about to play, and that Settings says whose music it is, which is
// what the pieces' licence (CC BY 4.0) asks for.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MUSIC_VOLUME,
  MUSIC_CREDIT,
  MUSIC_TRACKS,
  PASSAGE_DRAMA,
  createMusicDirector,
  cutTimeAfter,
  musicAddress,
  musicSceneOf,
  musicVolumeOf,
  setMusicScene,
  startMusic,
} from "./ambientMusic.js";
import { MAP_SETTING_KEYS } from "./mapSettings.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// A clock the test moves, and timers that fire as it passes them.
const clock = () => {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  return {
    get now() { return now; },
    onAdvance: (listener) => listeners.push(listener),
    timers: {
      set: (fn, ms) => { const id = nextId; nextId += 1; pending.set(id, { fn, at: now + ms }); return id; },
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

// An <audio> whose time moves with the clock while it plays.
const stage = ({ enabled = true, volume = 25, refuse = null, tracks = MUSIC_TRACKS } = {}) => {
  const time = clock();
  const settings = { enabled, volume };
  const made = [];
  const makeAudio = () => {
    const audio = {
      paused: true, loop: false, preload: "auto", src: "", volume: 1, currentTime: 0, plays: 0, pauses: 0,
      play() {
        audio.plays += 1;
        if (refuse) return Promise.reject(Object.assign(new Error("refused"), { name: refuse }));
        audio.paused = false;
        return Promise.resolve();
      },
      pause() { audio.pauses += 1; audio.paused = true; },
    };
    made.push(audio);
    return audio;
  };
  time.onAdvance((ms) => { for (const audio of made) if (!audio.paused) audio.currentTime += ms / 1000; });
  const director = createMusicDirector({
    makeAudio,
    addressOf: (file) => `/${file}`,
    read: () => ({ ...settings }),
    timers: time.timers,
    tracks,
  });
  const of = (name) => director.channels[name].audio;
  const sounding = () => Object.entries(director.channels).filter(([, ch]) => ch.audio && !ch.audio.paused && ch.audio.volume > 0).map(([name]) => name);
  return { director, made, settings, time, of, sounding };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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

test("a game opening: the same piece leaps to its loud stretch and plays louder", () => {
  const { director, time, of } = stage();
  director.unlock();
  time.advance(3000);
  director.setScene("loading");
  time.advance(600);
  const audio = of("passage");
  assert.ok(audio.currentTime >= PASSAGE_DRAMA.enter && audio.currentTime < PASSAGE_DRAMA.enter + 1, `at ${audio.currentTime}`);
  assert.equal(audio.paused, false);
  assert.ok(Math.abs(audio.volume - 0.25 * PASSAGE_DRAMA.boost) < 1e-9, "louder than the menu");
  assert.equal(director.inDrama, true);
  // The first hit is the first thing heard: the leap lands just before it.
  assert.ok(PASSAGE_DRAMA.cuts[0] - PASSAGE_DRAMA.enter > 0 && PASSAGE_DRAMA.cuts[0] - PASSAGE_DRAMA.enter < 0.5);
});

test("the game is drawn: the music runs on to the next hit, lets it land, and stops dead", () => {
  const { director, time, of, sounding } = stage();
  director.unlock();
  director.setScene("loading");
  // Loading takes 4 seconds: the music is past the first hit by then.
  time.advance(4000);
  const audio = of("passage");
  const drawnAt = audio.currentTime;
  director.setScene("game");
  const hit = PASSAGE_DRAMA.cuts.find((cut) => cut + PASSAGE_DRAMA.ring > drawnAt + 0.1);
  assert.equal(director.cutAt, hit + PASSAGE_DRAMA.ring);
  assert.equal(audio.paused, false, "still playing: it does not stop the moment the game is drawn");
  // Up to the hit, and a little into its ring.
  time.advance((hit + PASSAGE_DRAMA.ring - drawnAt) * 1000 - 100);
  assert.equal(audio.paused, false);
  time.advance(400);
  assert.equal(audio.paused, true, "stopped");
  assert.deepEqual(sounding(), []);
  assert.deepEqual([director.cutAt, director.inDrama], [null, false]);
  // No in-game piece has been chosen yet: a game is quiet.
  time.advance(10000);
  assert.deepEqual(sounding(), []);
  assert.equal(MUSIC_TRACKS.game, null);
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
});

test("a game still loading at the end of the loud stretch goes round it again; a stop past the last hit is at its end", () => {
  const { director, time, of } = stage();
  director.unlock();
  director.setScene("loading");
  time.advance((PASSAGE_DRAMA.wrapAt - PASSAGE_DRAMA.enter + 2) * 1000);
  const audio = of("passage");
  assert.ok(audio.currentTime >= PASSAGE_DRAMA.enter && audio.currentTime < PASSAGE_DRAMA.enter + 3, `went round: ${audio.currentTime}`);
  assert.equal(audio.paused, false);
  // Every hit is inside the stretch, in order, and each is reachable.
  assert.deepEqual([...PASSAGE_DRAMA.cuts].sort((a, b) => a - b), [...PASSAGE_DRAMA.cuts]);
  assert.ok(PASSAGE_DRAMA.cuts.every((cut) => cut > PASSAGE_DRAMA.enter && cut + PASSAGE_DRAMA.ring < PASSAGE_DRAMA.wrapAt));
  assert.equal(cutTimeAfter(PASSAGE_DRAMA.enter), PASSAGE_DRAMA.cuts[0] + PASSAGE_DRAMA.ring);
  assert.equal(cutTimeAfter(PASSAGE_DRAMA.cuts.at(-1) + 1), PASSAGE_DRAMA.wrapAt);
  // Never a long wait: the music is gone within a quarter of a minute of the game being drawn.
  for (let at = PASSAGE_DRAMA.enter; at < PASSAGE_DRAMA.wrapAt; at += 0.5) assert.ok(cutTimeAfter(at) - at < 15, `from ${at}`);
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
  // The loud stretch never goes past full volume.
  on.settings.volume = 100;
  on.director.setScene("loading");
  on.time.advance(600);
  assert.equal(on.of("passage").volume, 1);
});

test("a game opened before the first click starts in the right place at that click", () => {
  const loading = stage();
  loading.director.setScene("loading");
  assert.equal(loading.made.length, 0);
  loading.director.unlock();
  loading.time.advance(300);
  assert.ok(loading.of("passage").currentTime >= PASSAGE_DRAMA.enter);
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
  assert.equal(musicSceneOf({ inMenu: true, loading: true, war: true }), "menu");
  assert.equal(musicSceneOf({ loading: true, war: true }), "loading");
  assert.equal(musicSceneOf({ war: true }), "war");
  assert.equal(musicSceneOf({}), "game");
  const screen = read("src/Game/GameUI/main.jsx");
  assert.ok(screen.includes("const battlefieldShown = useWarRoom((room) => room.open || Boolean(room.battlefield));"));
  assert.ok(screen.includes("musicSceneOf({ inMenu: mainMenuOpen || hasNoGames, loading: showGameLoading, war: battlefieldShown })"));
  assert.ok(screen.includes("useEffect(() => { setMusicScene(musicScene); }, [musicScene]);"));
  // Started once, for every build, where the page starts; and no page, no music, no error.
  assert.ok(read("src/main.jsx").includes("startMusic({ env: import.meta.env });"));
  assert.equal(startMusic({ win: null, doc: null }), null);
  setMusicScene("war");
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
  assert.ok(settings.includes("Music: “Passage Of Time” and “Legionnaire (2022 Remaster)” by Scott Buckley, released under CC BY 4.0."));
  assert.ok(settings.includes("href={MUSIC_CREDIT.siteUrl}"));
  assert.deepEqual([MUSIC_CREDIT.artist, MUSIC_CREDIT.licence, MUSIC_CREDIT.site], ["Scott Buckley", "CC BY 4.0", "www.scottbuckley.com.au"]);
  assert.deepEqual([MUSIC_TRACKS.passage.work, MUSIC_TRACKS.war.work], ["Passage Of Time", "Legionnaire (2022 Remaster)"]);
  const credits = read("public/audio/CREDITS.txt");
  for (const part of ["Passage Of Time", "Legionnaire (2022 Remaster)", "Scott Buckley", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", "scottbuckley.com.au"]) assert.ok(credits.includes(part), part);
});
