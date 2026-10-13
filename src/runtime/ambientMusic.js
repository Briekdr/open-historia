/*! Open Historia — the game's music © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What plays, and when (the owner, 2026-10-13):
//   "add this as ambient music in game" — Passage Of Time;
//   "make this song play in loading screen then become super dramatic when you
//    start a game and its loading then it dramatically stops the music at
//    certain points in the song and a different song plays ingame";
//   "when in the war room or looking at a battlefield it should play this" —
//    Legionnaire.
//
// So the music follows where the player is (the SCENE):
//   menu     the menu and the screens before a game. Passage Of Time from its
//            quiet opening, on a loop.
//   loading  a game is opening under its cover. The same piece leaps to its
//            loudest stretch (PASSAGE_DRAMA.enter) and plays louder.
//   game     the game is drawn. The piece runs on to its next big hit (one of
//            PASSAGE_DRAMA.cuts), lets the hit land, and stops dead. After a
//            breath of silence the in-game piece comes in, when there is one.
//   war      the war room is open, or a battlefield is shown. Legionnaire.
//
// Both pieces are Scott Buckley's, released under CC BY 4.0
// (www.scottbuckley.com.au). That licence lets the game ship them as long as
// it says whose they are: Settings → General → Sound does, and so does
// public/audio/CREDITS.txt beside the files, which are the composer's own,
// unchanged. The times in PASSAGE_DRAMA were measured from the file (its
// loudness in 50 ms steps): they belong to this recording and no other.
//
// The rest:
//   * on unless the player turns it off (Settings → General → Sound), at a
//     volume they set there;
//   * nothing sounds before the player's first click, tap or key press,
//     because no browser lets a page make sound before one;
//   * a file is not asked for until it is about to play, and never while the
//     music is off: a player who turns it off downloads nothing;
//   * everything stops while the page is hidden (a minimised window, another
//     tab, the Android app in the background) and carries on after.
//
// The files are the game's own, served beside the page: nothing is fetched
// from anybody else.

import { MAP_SETTING_KEYS, getMapSettingDefaultOn, getMapSettingValue } from "./mapSettings.js";

const COMPOSER = Object.freeze({
  artist: "Scott Buckley",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  site: "www.scottbuckley.com.au",
  siteUrl: "https://www.scottbuckley.com.au/",
});

// `work` is the piece's name as its composer gives it, never translated.
export const MUSIC_TRACKS = Object.freeze({
  passage: Object.freeze({ file: "audio/passage-of-time.mp3", work: "Passage Of Time", ...COMPOSER }),
  war: Object.freeze({ file: "audio/legionnaire.mp3", work: "Legionnaire (2022 Remaster)", ...COMPOSER }),
  // The piece that plays in a game. None has been chosen yet: until one is,
  // a game is quiet outside the war room.
  game: null,
});
// What Settings names and links (one composer so far).
export const MUSIC_CREDIT = COMPOSER;

// Passage Of Time's loud stretch, in seconds of the file.
export const PASSAGE_DRAMA = Object.freeze({
  // Just before the hit that opens the full orchestra, so the hit is the first
  // thing heard.
  enter: 168.45,
  // Where the loud stretch ends: a game still loading by then is taken back to
  // `enter` rather than on into the quiet ending.
  wrapAt: 226.4,
  // The big hits. The music stops on the first one that comes after the game
  // is drawn.
  cuts: Object.freeze([168.6, 174.3, 177.6, 186.4, 193.8, 198.1, 201.55, 206.9, 214.45, 222.05]),
  // How long a hit is let ring before the silence.
  ring: 0.3,
  // Louder than the menu, as far as the player's volume leaves room.
  boost: 1.6,
});

export const MUSIC_SCENES = Object.freeze(["menu", "loading", "game", "war"]);

// Out of 100, as the slider shows it. Quiet: it is under the game, not over it.
export const DEFAULT_MUSIC_VOLUME = 25;

// How long things take, in milliseconds.
const FADE = Object.freeze({ menuIn: 1500, leap: 200, leapIn: 120, stop: 50, cross: 900, breath: 1500, gameIn: 3000 });
const TICK_MS = 25;
const FADE_STEP_MS = 40;

export const musicEnabled = () => getMapSettingDefaultOn(MAP_SETTING_KEYS.ambientMusic);

// The stored volume as a whole number from 0 to 100. Anything that is not one
// (never set, a damaged value) is the default.
export const musicVolumeOf = (stored) => {
  const text = String(stored ?? "").trim();
  const number = text === "" ? Number.NaN : Number(text);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : DEFAULT_MUSIC_VOLUME;
};
export const musicVolume = () => musicVolumeOf(getMapSettingValue(MAP_SETTING_KEYS.musicVolume, ""));

// Where a file is, from where the build is served ("/" in the desktop app,
// "/play/" on the website, "./" in the Android app).
export const musicAddress = (file, base = "/") => `${String(base || "/").replace(/\/*$/, "/")}${file}`;

// When the music stops, for a game drawn at `time` in the file: just after the
// first hit still far enough ahead to be reached, and past the last of them at
// the end of the loud stretch, which is a stop of its own.
export const cutTimeAfter = (time, drama = PASSAGE_DRAMA) => {
  const hit = drama.cuts.find((cut) => cut + drama.ring > time + 0.1);
  return hit === undefined ? drama.wrapAt : hit + drama.ring;
};

// The director. `makeAudio` makes an <audio> (or a stand-in under test), `read`
// says what the settings are now, `timers` is { set(fn, ms) → id, clear(id) }.
// It owns no listeners: the caller tells it the scene, the first gesture, and
// when the page hides.
export const createMusicDirector = ({ makeAudio, addressOf, read, timers, tracks = MUSIC_TRACKS, drama = PASSAGE_DRAMA }) => {
  // One channel a piece: its element (made when first needed), whether it
  // should be sounding, how loud beside the others (0 to 1) and its boost.
  const channel = (track) => ({ track, audio: null, want: false, gain: 0, boost: 1, fade: null, startAt: null });
  const channels = { passage: channel(tracks.passage), war: channel(tracks.war), game: channel(tracks.game) };

  let scene = "menu";
  // A click, a tap or a key press has happened: sound is allowed.
  let unlocked = false;
  let hidden = false;
  // Passage Of Time is in its loud stretch (loading), and, once the game is
  // drawn, the time in the file at which it stops.
  let inDrama = false;
  let cutAt = null;
  let tick = null;
  let breath = null;

  const settings = () => read();
  const audible = () => {
    const { enabled, volume } = settings();
    return enabled && volume > 0 && unlocked && !hidden;
  };

  const setVolume = (ch) => {
    if (!ch.audio) return;
    ch.audio.volume = Math.max(0, Math.min(1, (settings().volume / 100) * ch.gain * ch.boost));
  };

  const ensure = (ch) => {
    if (ch.audio || !ch.track) return ch.audio;
    ch.audio = makeAudio();
    // Nothing is fetched before play() asks for it.
    ch.audio.preload = "none";
    ch.audio.loop = true;
    ch.audio.src = addressOf(ch.track.file);
    // Where it was told to be before it existed (a game opened before the
    // first click): a browser keeps this as where playing starts.
    if (ch.startAt !== null) { try { ch.audio.currentTime = ch.startAt; } catch { /* from the start, then */ } }
    ch.startAt = null;
    return ch.audio;
  };

  // Makes what sounds agree with what is wanted. A browser that still refuses
  // (no gesture it accepts yet) is asked again at the next one; a file that
  // cannot be played is silence, never an error.
  const refresh = () => {
    const on = audible();
    for (const ch of Object.values(channels)) {
      if (!ch.track) continue;
      const playing = on && ch.want;
      if (!playing) {
        if (ch.audio && !ch.audio.paused) ch.audio.pause();
        continue;
      }
      ensure(ch);
      setVolume(ch);
      if (!ch.audio.paused) continue;
      const started = ch.audio.play();
      if (started && typeof started.catch === "function") {
        started.catch((error) => { if (error?.name === "NotAllowedError") unlocked = false; });
      }
    }
    if (on && (inDrama || cutAt !== null)) startTick();
    else stopTick();
  };

  const stopFade = (ch) => { if (ch.fade !== null) { timers.clear(ch.fade); ch.fade = null; } };
  // Moves a channel's loudness to `gain` over `ms`, then calls `then`.
  const fadeTo = (ch, gain, ms, then = null) => {
    stopFade(ch);
    const from = ch.gain;
    const steps = Math.max(1, Math.round(ms / FADE_STEP_MS));
    let done = 0;
    const step = () => {
      done += 1;
      ch.gain = from + (gain - from) * (done / steps);
      setVolume(ch);
      if (done < steps) { ch.fade = timers.set(step, FADE_STEP_MS); return; }
      ch.fade = null;
      if (then) then();
    };
    if (ms <= 0 || !audible()) {
      ch.gain = gain;
      setVolume(ch);
      if (then) then();
      return;
    }
    ch.fade = timers.set(step, FADE_STEP_MS);
  };
  const seek = (ch, time) => {
    if (!ch.audio) { ch.startAt = time; return; }
    try { ch.audio.currentTime = time; } catch { /* a file not yet seekable plays from where it is */ }
  };
  // Fades a channel out and holds it where it was, or (rewind) at its start.
  const silence = (ch, ms, { rewind = false } = {}) => {
    fadeTo(ch, 0, ms, () => {
      ch.want = false;
      if (rewind) seek(ch, 0);
      refresh();
    });
  };
  const bring = (ch, ms) => {
    if (!ch.track) return;
    ch.want = true;
    refresh();
    fadeTo(ch, 1, ms);
  };

  const stopTick = () => { if (tick !== null) { timers.clear(tick); tick = null; } };
  const startTick = () => {
    if (tick !== null) return;
    const beat = () => {
      tick = null;
      const audio = channels.passage.audio;
      if (!audio || !audible()) return;
      const time = audio.currentTime;
      if (cutAt !== null && time >= cutAt) { cut(); return; }
      // Still loading at the end of the loud stretch: round again.
      if (time >= drama.wrapAt) seek(channels.passage, drama.enter);
      tick = timers.set(beat, TICK_MS);
    };
    tick = timers.set(beat, TICK_MS);
  };

  const clearBreath = () => { if (breath !== null) { timers.clear(breath); breath = null; } };
  // What a game sounds like once the loading music is out of the way.
  const settle = () => {
    clearBreath();
    if (scene === "war") bring(channels.war, FADE.cross);
    else if (scene === "game") bring(channels.game, FADE.gameIn);
  };

  // The stop: the hit has landed, and then nothing.
  const cut = () => {
    const ch = channels.passage;
    cutAt = null;
    inDrama = false;
    stopTick();
    ch.boost = 1;
    fadeTo(ch, 0, FADE.stop, () => {
      ch.want = false;
      seek(ch, 0);
      refresh();
      breath = timers.set(() => { breath = null; settle(); }, FADE.breath);
    });
  };

  const toMenu = () => {
    clearBreath();
    cutAt = null;
    inDrama = false;
    silence(channels.war, FADE.cross);
    silence(channels.game, FADE.cross);
    const ch = channels.passage;
    // From its quiet opening, whatever it was doing.
    if (ch.want) seek(ch, 0);
    ch.boost = 1;
    bring(ch, FADE.menuIn);
  };

  const toLoading = () => {
    clearBreath();
    cutAt = null;
    silence(channels.war, FADE.leap);
    silence(channels.game, FADE.leap);
    const ch = channels.passage;
    const leap = () => {
      inDrama = true;
      ch.want = true;
      ch.boost = drama.boost;
      refresh();
      seek(ch, drama.enter);
      fadeTo(ch, 1, FADE.leapIn);
      refresh();
    };
    // Sounding already (the menu): a quick dip, then the leap. Not sounding:
    // straight in.
    if (ch.want && ch.gain > 0 && audible()) fadeTo(ch, 0, FADE.leap, leap);
    else leap();
  };

  const toGame = () => {
    const ch = channels.passage;
    const sounding = ch.want && ch.audio && !ch.audio.paused && audible();
    if (inDrama && sounding) {
      // Runs on to the next hit, and stops there (cut).
      cutAt = cutTimeAfter(ch.audio.currentTime, drama);
      startTick();
      return;
    }
    // Nothing dramatic to stop: the menu's music fades, and the game's comes in.
    inDrama = false;
    cutAt = null;
    silence(ch, FADE.cross, { rewind: true });
    silence(channels.war, FADE.cross);
    settle();
  };

  const toWar = () => {
    // The war room does not wait for a hit: the loading music stops now.
    if (inDrama || cutAt !== null) {
      cutAt = null;
      inDrama = false;
      stopTick();
      clearBreath();
      channels.passage.boost = 1;
    }
    silence(channels.passage, FADE.stop, { rewind: true });
    silence(channels.game, FADE.cross);
    clearBreath();
    bring(channels.war, FADE.cross);
  };

  const enter = { menu: toMenu, loading: toLoading, game: toGame, war: toWar };

  const setScene = (next) => {
    if (!MUSIC_SCENES.includes(next) || next === scene) return;
    const from = scene;
    scene = next;
    // Leaving the war room for the game: Legionnaire gives way to the game's piece.
    if (from === "war" && next === "game") {
      silence(channels.war, FADE.cross);
      settle();
      return;
    }
    enter[next]();
  };

  // The first sound of a session: whatever the scene is by then.
  const begin = () => {
    if (scene === "menu") { channels.passage.boost = 1; bring(channels.passage, FADE.menuIn); }
    else if (scene === "loading") toLoading();
    else settle();
  };

  return {
    setScene,
    // Something the director depends on changed (the switch, the volume).
    sync: () => { for (const ch of Object.values(channels)) setVolume(ch); refresh(); },
    unlock: () => {
      if (unlocked) return;
      unlocked = true;
      const idle = Object.values(channels).every((ch) => !ch.want);
      if (idle) begin();
      else refresh();
    },
    setHidden: (value) => { hidden = Boolean(value); refresh(); },
    get scene() { return scene; },
    get unlocked() { return unlocked; },
    get cutAt() { return cutAt; },
    get inDrama() { return inDrama; },
    channels,
  };
};

// The scene, from what the game's screen knows (GameUI/main.jsx).
export const musicSceneOf = ({ inMenu = false, loading = false, war = false } = {}) => {
  if (inMenu) return "menu";
  if (loading) return "loading";
  return war ? "war" : "game";
};

// Starts the music for this page, once. Returns the director, or null where
// there is no page to play in (a test, a worker).
let started = null;
export const startMusic = ({
  env = {},
  win = typeof window === "undefined" ? null : window,
  doc = typeof document === "undefined" ? null : document,
} = {}) => {
  if (started || !win || !doc || typeof win.Audio !== "function") return started;
  const director = createMusicDirector({
    makeAudio: () => new win.Audio(),
    addressOf: (file) => musicAddress(file, env.BASE_URL),
    read: () => ({ enabled: musicEnabled(), volume: musicVolume() }),
    timers: { set: (fn, ms) => win.setTimeout(fn, ms), clear: (id) => win.clearTimeout(id) },
  });
  // Capturing, so a control that stops the event still counts as the gesture.
  for (const type of ["pointerdown", "keydown", "touchend"]) {
    win.addEventListener(type, () => director.unlock(), { capture: true, passive: true });
  }
  win.addEventListener("mapSettings:updated", () => director.sync());
  doc.addEventListener("visibilitychange", () => director.setHidden(doc.visibilityState === "hidden"));
  director.setHidden(doc.visibilityState === "hidden");
  started = director;
  return director;
};

// Tells the music where the player is. Before the page's music has started
// (a test, a worker) it is nothing.
export const setMusicScene = (scene) => { started?.setScene(scene); };
