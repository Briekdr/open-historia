/*! Open Historia — the game's music © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What plays, and when (the owner, 2026-10-13):
//   "add this as ambient music in game" — Passage Of Time;
//   "make this song play in loading screen then become super dramatic when you
//    start a game and its loading then it dramatically stops the music at
//    certain points in the song and a different song plays ingame";
//   "when in the war room or looking at a battlefield it should play this" —
//    Legionnaire; and "have this also be a war soundtrack" — Vanguard;
//   "make it not be as dramatic when idle in the main menu and ramp up
//    dramaticism when loading";
//   "scenario creators should be able to add different tracks and songs for
//    different situations" — from the community hub's music list.
//
// So the music follows where the player is (the SCENE):
//   menu     the menu and the screens before a game. The quiet opening of
//            Passage Of Time and nothing after it, round and round
//            (PASSAGE_CALM): somebody idling there never reaches the loud
//            part.
//   loading  a game is opening under its cover. The same piece moves into its
//            build, at the phrase from which the big hit lands just after the
//            game is expected to be drawn (entryFor), and grows louder on the
//            way to it (boostAt).
//   game     the game is drawn. The piece runs on to its next accent or hit
//            (one of PASSAGE_DRAMA.cuts), lets it land, and stops dead. After
//            a breath of silence the in-game piece comes in, when there is one.
//   atWar    in the game, with the player's troops on a battlefield. Whatever
//            the game plays, unless the scenario has music of its own for it.
//   war      the war room is open, or a battlefield is shown. Legionnaire,
//            then Vanguard, then Legionnaire again (MUSIC_WAR_PIECES): one
//            after the other, as a list plays.
//
// A list plays in order, the next piece when one ends, round again at the
// end. Leaving its scene fades it out where it is, and coming back carries on
// from there.
//
// A scenario may name tracks of the community hub's music list for a game
// opening, the game, the player at war and the war room
// (server/scenarioMusic.js; in its record the last is `battle`). Where it
// does, and the hub still lists them, that situation plays the scenario's
// list instead of the game's own music for it. A track that cannot be played
// is passed over, and a list none of whose tracks can be played gives the
// situation back to the game's own. The menu is never a scenario's.
//
// All of the game's own pieces are Scott Buckley's, released under CC BY 4.0
// (www.scottbuckley.com.au). That licence lets the game ship them as long as
// it says whose they are: Settings → General → Sound does, and so does
// public/audio/CREDITS.txt beside the files, which are the composer's own,
// unchanged. The times in PASSAGE_CALM and PASSAGE_DRAMA were measured from
// the file (its loudness in 50 ms steps): they belong to this recording and
// no other. A hub track's credit is the hub's (Settings shows the one that is
// playing).
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
// The game's own files are served beside the page. A hub track is played from
// the address every hub file is fetched through (hubMusic.js
// playableAddressOf), handed to the <audio> as its src: its bytes are never
// read into the page.

import { SCENARIO_MUSIC_SITUATIONS } from "../../server/scenarioMusic.js";
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
  vanguard: Object.freeze({ file: "audio/vanguard.mp3", work: "Vanguard", ...COMPOSER }),
  // The piece that plays in a game. None has been chosen yet: until one is,
  // a game is quiet outside the war room.
  game: null,
});
// The war room's pieces (names in MUSIC_TRACKS), in the order they play: one
// after the other, round again at the end. A session starts on the first.
export const MUSIC_WAR_PIECES = Object.freeze(["war", "vanguard"]);
// What Settings names and links (one composer so far).
export const MUSIC_CREDIT = COMPOSER;

// The menu's part of Passage Of Time, in seconds of the file: its quiet
// opening (0 to 66; from 67.4 the piece starts to rise). It fades out from
// `fadeFrom`, after the accent at 61.40 has rung, is silent by `end`, and
// starts again from 0, coming back in over `fadeIn` milliseconds.
export const PASSAGE_CALM = Object.freeze({ fadeFrom: 63.0, end: 66.0, fadeIn: 2500 });

// Passage Of Time's build and its loud stretch, in seconds of the file.
export const PASSAGE_DRAMA = Object.freeze({
  // Where a game opening comes in: the starts of the build's phrases, each
  // just before an accent. The last is just before the big hit itself.
  entries: Object.freeze([145.3, 149.75, 157.3, 161.2, 164.7, 166.9, 168.45]),
  // The big hit that opens the full orchestra.
  hit: 168.6,
  // Just before it, so the hit is the first thing heard: where a game still
  // loading at the end of the loud stretch is taken back to.
  enter: 168.45,
  // Where the loud stretch ends: a game still loading by then goes round the
  // loud stretch again rather than on into the quiet ending.
  wrapAt: 226.4,
  // The build's accents and the loud stretch's hits. The music stops on the
  // first one that comes after the game is drawn, so a game drawn early never
  // waits long for it.
  cuts: Object.freeze([149.9, 157.45, 161.35, 168.6, 174.3, 177.6, 186.4, 193.8, 198.1, 201.55, 206.9, 214.45, 222.05]),
  // How long a hit is let ring before the silence.
  ring: 0.3,
  // Louder than the menu from the big hit on, as far as the player's volume
  // leaves room; the build grows towards it (boostAt).
  boost: 1.6,
});

// How long a game takes to open on this device is learned from the last few
// times one did (seconds): `kept` of them that lasted at least `shortest`,
// their median held between `least` and `most`, and `unknown` before any has
// been timed. The entry leaves `margin` between the game being drawn and the
// big hit.
export const PASSAGE_LOADS = Object.freeze({ kept: 5, shortest: 0.5, least: 1, most: 40, unknown: 6, margin: 0.5 });

export const MUSIC_SCENES = Object.freeze(["menu", "loading", "game", "atWar", "war"]);

// Out of 100, as the slider shows it. Quiet: it is under the game, not over it.
export const DEFAULT_MUSIC_VOLUME = 25;

// How long things take, in milliseconds.
const FADE = Object.freeze({ menuIn: 1500, dip: 400, entryIn: 600, stop: 50, cross: 900, breath: 1500, gameIn: 3000 });
// How often the loud stretch is watched for its stop, and the menu for the end
// of the quiet opening, which is in no hurry.
const TICK_MS = 25;
const CALM_TICK_MS = 200;
const FADE_STEP_MS = 40;
// The look that ends a round of the quiet opening is aimed this many seconds
// before its end, where the fade has left a hundredth of the sound: a timer is
// never early and often a little late, and the piece must not be heard, or
// found, past the end.
const CALM_LANDING_S = 0.03;

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

// Where a game opening comes into the build, for a game expected to take
// `expectedSeconds` to draw: the latest entry that still leaves that long, and
// the margin, before the big hit, so the hit lands just after the game
// appears. A game slower than the whole build comes in at its start.
export const entryFor = (expectedSeconds, drama = PASSAGE_DRAMA) => {
  const expected = Number.isFinite(expectedSeconds) ? expectedSeconds : PASSAGE_LOADS.unknown;
  // To the millisecond: 168.6 - 166.9 is not quite 1.7 in floating point.
  const lead = (entry) => Math.round((drama.hit - entry) * 1000) / 1000;
  const inTime = drama.entries.filter((entry) => lead(entry) >= expected + PASSAGE_LOADS.margin);
  return inTime.length ? Math.max(...inTime) : Math.min(...drama.entries);
};

// How much louder than the menu the piece is at `time`, having come in at
// `entry`: as the menu at the entry, the full boost at the big hit, and evenly
// between by where the music is, not by the clock. No entry (the loud stretch
// gone round again) is the full boost.
export const boostAt = (time, entry, drama = PASSAGE_DRAMA) => {
  if (entry === null || entry === undefined || entry >= drama.hit || time >= drama.hit) return drama.boost;
  if (time <= entry) return 1;
  return 1 + (drama.boost - 1) * ((time - entry) / (drama.hit - entry));
};

// The loadings worth learning from, oldest first: the last few that lasted
// long enough to be one.
const loadSecondsOf = (list) => (Array.isArray(list) ? list : [])
  .filter((seconds) => Number.isFinite(seconds) && seconds >= PASSAGE_LOADS.shortest)
  .slice(-PASSAGE_LOADS.kept);

// How long the next game is expected to take to open, from those.
export const expectedLoadSeconds = (list) => {
  const sorted = loadSecondsOf(list).sort((a, b) => a - b);
  if (!sorted.length) return PASSAGE_LOADS.unknown;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.max(PASSAGE_LOADS.least, Math.min(PASSAGE_LOADS.most, median));
};

// The director. `makeAudio` makes an <audio> (or a stand-in under test), `read`
// says what the settings are now, `timers` is { set(fn, ms) → id, clear(id) },
// `now` the time in milliseconds, and `memory` ({ read() → seconds[],
// write(list) }) keeps how long games took to open. `onNowPlaying` is told the
// hub track that is sounding, or null. It owns no listeners on the page: the
// caller tells it the scene, the first gesture, and when the page hides.
export const createMusicDirector = ({
  makeAudio,
  addressOf,
  read,
  timers,
  now = null,
  memory = null,
  onNowPlaying = null,
  tracks = MUSIC_TRACKS,
  warPieces = MUSIC_WAR_PIECES,
  drama = PASSAGE_DRAMA,
  calm = PASSAGE_CALM,
}) => {
  // One channel a piece: its element (made when first needed), whether it
  // should be sounding, how loud beside the others (0 to 1) and its boost
  // (the build's and the loud stretch's, and under 1 while the menu's quiet
  // opening dies away).
  const channel = (track) => ({ track, audio: null, want: false, gain: 0, boost: 1, fade: null, startAt: null });
  // One channel a list: its tracks ({ id, src, … }), which one it is on, the
  // address its one element holds, how many in a row could not be played, and
  // whether none could (`dead`).
  const playlist = (key, items = []) => ({ key, tracks: items, index: 0, loaded: "", turn: 0, misses: 0, dead: false, audio: null, want: false, gain: 0, boost: 1, fade: null });
  // The game's own: Passage Of Time, the in-game piece, and the war room's
  // list of pieces.
  const channels = {
    passage: channel(tracks.passage),
    war: playlist("war", warPieces.flatMap((name) => (tracks[name] ? [{ id: name, src: addressOf(tracks[name].file) }] : []))),
    game: channel(tracks.game),
  };
  // A scenario's: one list a situation, of tracks as the hub's list resolved
  // them. One of these that cannot be played gives way to the game's own.
  const lists = Object.fromEntries(SCENARIO_MUSIC_SITUATIONS.map((key) => [key, playlist(key)]));
  const pieces = [channels.passage, channels.game];
  const playlists = [channels.war, ...Object.values(lists)];
  const everyChannel = () => [...pieces, ...playlists];

  let scene = "menu";
  // A click, a tap or a key press has happened: sound is allowed.
  let unlocked = false;
  let hidden = false;
  // Something else is being listened to (a track tried out in the scenario
  // editor): the music waits.
  let held = false;
  // Passage Of Time is in its build or its loud stretch (loading); where it
  // came in, which its loudness grows from (null: at the full boost); and,
  // once the game is drawn, the time in the file at which it stops.
  let inDrama = false;
  let rampFrom = null;
  let cutAt = null;
  let tick = null;
  let breath = null;
  // When the game now opening began to, and how long the last few took.
  const clock = typeof now === "function" ? now : typeof timers.now === "function" ? () => timers.now() : () => Date.now();
  let loadingSince = null;
  let loads = [];
  try { loads = loadSecondsOf(memory?.read()); } catch { /* nothing remembered */ }
  // The hub track last said to be sounding.
  let playing = null;

  const settings = () => read();
  const audible = () => {
    const { enabled, volume } = settings();
    return enabled && volume > 0 && unlocked && !hidden && !held;
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

  // A list has something to play.
  const usable = (list) => list.tracks.length > 0 && !list.dead;

  // What a scene sounds like: the scenario's list for it when it has one that
  // plays, else the game's own music for it. At war with no list of its own
  // is whatever the game plays.
  const voiceOf = (where) => {
    if (where === "menu") return channels.passage;
    const own = where === "loading" ? lists.loading : where === "war" ? lists.battle : where === "atWar" ? lists.atWar : lists.game;
    if (usable(own)) return own;
    if (where === "atWar" && usable(lists.game)) return lists.game;
    return where === "loading" ? channels.passage : where === "war" ? channels.war : channels.game;
  };

  // Tells whoever shows it which hub track is sounding now, when that changed.
  const announce = () => {
    if (!onNowPlaying) return;
    const sounding = (list) => list.want && usable(list) && list.audio && !list.audio.paused;
    const voice = voiceOf(scene);
    const list = !audible() ? null : lists[voice.key] === voice && sounding(voice) ? voice : Object.values(lists).find(sounding);
    const track = list ? list.tracks[list.index] : null;
    if (track === playing) return;
    playing = track;
    onNowPlaying(track);
  };

  // Gives a list's element the track it is on. Made, and its file named, only
  // here: when the track is about to play. True when the element was given
  // another file than it held.
  const load = (list) => {
    if (!list.audio) {
      list.audio = makeAudio();
      list.audio.preload = "none";
      list.audio.loop = false;
      list.audio.addEventListener?.("ended", () => next(list));
      // An element given another file has no error any more: what it says of
      // the one before is old news.
      list.audio.addEventListener?.("error", () => { if (list.audio.error !== null) miss(list, list.turn); });
    }
    const { src } = list.tracks[list.index];
    if (list.loaded === src) return false;
    list.audio.src = src;
    list.loaded = src;
    list.turn += 1;
    return true;
  };

  const start = (list) => {
    const { turn } = list;
    const started = list.audio.play();
    if (!started || typeof started.then !== "function") return;
    started.then(
      () => { if (turn === list.turn) list.misses = 0; },
      (error) => {
        if (error?.name === "NotAllowedError") { unlocked = false; return; }
        // Paused, or given another file, before it began: not a failure.
        if (error?.name === "AbortError") return;
        miss(list, turn);
      },
    );
  };

  // Makes what sounds agree with what is wanted. A browser that still refuses
  // (no gesture it accepts yet) is asked again at the next one; a file of the
  // game's own that cannot be played is silence, never an error.
  const refresh = () => {
    const on = audible();
    for (const ch of pieces) {
      if (!ch.track) continue;
      const sounding = on && ch.want;
      if (!sounding) {
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
    for (const list of playlists) {
      const sounding = on && list.want && usable(list);
      if (!sounding) {
        if (list.audio && !list.audio.paused) list.audio.pause();
        continue;
      }
      const another = load(list);
      setVolume(list);
      if (another || list.audio.paused) start(list);
    }
    if (on && watching()) startTick();
    else stopTick();
    announce();
  };

  const stopFade = (ch) => { if (ch.fade !== null) { timers.clear(ch.fade); ch.fade = null; } };
  // Moves a channel's loudness to `gain` over `ms`, then calls `then`. One
  // already there is there at once.
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
    if (ms <= 0 || from === gain || !audible()) {
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
    if (ch.tracks ? !usable(ch) : !ch.track) return;
    ch.want = true;
    refresh();
    fadeTo(ch, 1, ms);
  };

  // A list's track ended, or could not be played: the next one, round again
  // at the end. Its file is asked for when it plays, which is now if the list
  // is still sounding.
  const next = (list) => {
    if (!list.tracks.length) return;
    list.index = (list.index + 1) % list.tracks.length;
    refresh();
  };
  // A track that could not be played (said by its element, or by play()
  // itself: `turn` is which file that was, so one failure counts once). The
  // next is tried; when none of a scenario's list could be, the situation
  // goes back to the game's own music, and when none of the game's own war
  // pieces could, the war room is silent: never an error.
  const miss = (list, turn) => {
    if (turn !== list.turn || !usable(list)) return;
    list.turn += 1;
    list.misses += 1;
    // An element that failed still counts itself as playing: paused, so the
    // next track (were it the same file again) is started and not waited for.
    if (list.audio && !list.audio.paused) list.audio.pause();
    if (list.misses < list.tracks.length) { next(list); return; }
    stopFade(list);
    Object.assign(list, { dead: true, want: false, gain: 0 });
    revoice();
  };

  // What the watch below is for: the end of the quiet opening on the menu,
  // and the build, the wrap and the stop while a game opens.
  const watching = () => (scene === "menu" ? channels.passage.want : inDrama || cutAt !== null);
  const stopTick = () => { if (tick !== null) { timers.clear(tick); tick = null; } };
  const startTick = () => {
    if (tick !== null) return;
    const beat = () => {
      tick = null;
      const ch = channels.passage;
      const audio = ch.audio;
      if (!audio || !audible() || !watching()) return;
      const time = audio.currentTime;
      if (scene === "menu") {
        const landing = calm.end - CALM_LANDING_S;
        if (time >= landing) {
          // The quiet opening is over, in silence: from the top again.
          seek(ch, 0);
          ch.boost = 1;
          ch.gain = 0;
          setVolume(ch);
          fadeTo(ch, 1, calm.fadeIn);
          tick = timers.set(beat, CALM_TICK_MS);
          return;
        }
        // It dies away by where the music is, not by the clock: silent at the
        // end however the page's timers ran.
        const dying = time >= calm.fadeFrom;
        const boost = dying ? (calm.end - time) / (calm.end - calm.fadeFrom) : 1;
        if (boost !== ch.boost) { ch.boost = boost; setVolume(ch); }
        // Slowly until the fade, then at a fade's pace; and the next look is
        // never later than where the fade begins, or where the round ends.
        const left = ((dying ? landing : calm.fadeFrom) - time) * 1000;
        tick = timers.set(beat, Math.max(1, Math.min(dying ? FADE_STEP_MS : CALM_TICK_MS, left)));
        return;
      }
      if (cutAt !== null && time >= cutAt) { cut(); return; }
      // Still loading at the end of the loud stretch: round it again, as loud.
      if (time >= drama.wrapAt) { seek(ch, drama.enter); rampFrom = null; }
      const boost = boostAt(audio.currentTime, rampFrom, drama);
      if (boost !== ch.boost) { ch.boost = boost; setVolume(ch); }
      tick = timers.set(beat, TICK_MS);
    };
    tick = timers.set(beat, scene === "menu" ? CALM_TICK_MS : TICK_MS);
  };

  const clearBreath = () => { if (breath !== null) { timers.clear(breath); breath = null; } };
  // A scene's voice in, and every other voice of a game out. (Passage Of Time
  // is not one of them: the menu and a game opening see to it themselves.)
  const sound = (voice) => {
    for (const ch of [channels.game, ...playlists]) if (ch !== voice) silence(ch, FADE.cross);
    bring(voice, voice === channels.game ? FADE.gameIn : FADE.cross);
  };
  // What a game sounds like once the loading music is out of the way.
  const settle = () => {
    clearBreath();
    if (scene === "menu" || scene === "loading") return;
    sound(voiceOf(scene));
  };

  // The stop: the hit has landed, and then nothing.
  const cut = () => {
    const ch = channels.passage;
    cutAt = null;
    inDrama = false;
    rampFrom = null;
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
    rampFrom = null;
    silence(channels.game, FADE.cross);
    for (const list of playlists) {
      silence(list, FADE.cross);
      // A list that could not be played is tried again in the next game.
      list.dead = false;
      list.misses = 0;
    }
    const ch = channels.passage;
    // From its quiet opening, whatever it was doing.
    if (ch.want) seek(ch, 0);
    ch.boost = 1;
    bring(ch, FADE.menuIn);
  };

  // How much longer the game now opening is expected to take.
  const loadLeft = () => {
    const spent = loadingSince === null ? 0 : (clock() - loadingSince) / 1000;
    return Math.max(0, expectedLoadSeconds(loads) - spent);
  };

  const toLoading = () => {
    clearBreath();
    cutAt = null;
    const ch = channels.passage;
    const voice = voiceOf("loading");
    if (voice !== ch) {
      // The scenario's own loading music: no build and no stop on a hit. It
      // fades out when the game is drawn, like any list.
      inDrama = false;
      rampFrom = null;
      silence(ch, FADE.cross, { rewind: true });
      sound(voice);
      return;
    }
    for (const other of [channels.game, ...playlists]) silence(other, FADE.dip);
    const entry = entryFor(loadLeft(), drama);
    const comeIn = () => {
      inDrama = true;
      rampFrom = entry;
      ch.want = true;
      ch.boost = boostAt(entry, entry, drama);
      refresh();
      seek(ch, entry);
      fadeTo(ch, 1, FADE.entryIn);
      refresh();
    };
    // Sounding already (the menu): a short fade out, then in at the entry.
    // Not sounding: straight in.
    if (ch.want && ch.gain > 0 && audible()) fadeTo(ch, 0, FADE.dip, comeIn);
    else comeIn();
  };

  // The game is drawn (in it, or in it at war).
  const toPlay = () => {
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
    rampFrom = null;
    cutAt = null;
    silence(ch, FADE.cross, { rewind: true });
    settle();
  };

  const toWar = () => {
    // The war room does not wait for a hit: the loading music stops now.
    if (inDrama || cutAt !== null) {
      cutAt = null;
      inDrama = false;
      rampFrom = null;
      stopTick();
      channels.passage.boost = 1;
    }
    silence(channels.passage, FADE.stop, { rewind: true });
    settle();
  };

  const enter = { menu: toMenu, loading: toLoading, game: toPlay, atWar: toPlay, war: toWar };
  const inPlay = (where) => where === "game" || where === "atWar";

  // The scene's voice is another than it was (the scenario's lists arrived or
  // changed, or one of them could not be played): what sounds follows. A stop
  // on a hit or the breath after it is left to finish; it ends in settle().
  const revoice = () => {
    if (scene === "loading") toLoading();
    else if (scene !== "menu" && cutAt === null && breath === null) settle();
    else announce();
  };

  // How long a game took to open: remembered, for the next one's entry.
  const noteLoad = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < PASSAGE_LOADS.shortest) return;
    loads = loadSecondsOf([...loads, Math.round(seconds * 100) / 100]);
    try { memory?.write([...loads]); } catch { /* it is learned again */ }
  };

  const setScene = (to) => {
    if (!MUSIC_SCENES.includes(to) || to === scene) return;
    const from = scene;
    scene = to;
    // The menu's slow watch is not the one a game opening needs: the next
    // refresh starts it again at the pace of the scene.
    if (from === "menu") stopTick();
    // Timed whether or not anything sounds: it is about the device, not the
    // music. A game given up for the menu was not opened.
    if (to === "loading") loadingSince = clock();
    else if (from === "loading") {
      if (to !== "menu" && loadingSince !== null) noteLoad((clock() - loadingSince) / 1000);
      loadingSince = null;
    }
    // Leaving the war room for the game: its music gives way to the game's.
    if (from === "war" && inPlay(to)) { settle(); return; }
    // At war or no longer, in the game all the while. While the loading music
    // is still running to its hit, the game's comes in after it as it would.
    if (inPlay(from) && inPlay(to)) {
      if (cutAt === null && breath === null) settle();
      return;
    }
    enter[to]();
  };

  // The scenario's lists, as the hub's list resolved them:
  // { loading: [{ id, src, … }], game, atWar, battle }, or null for none. A
  // list that is the same as before carries on where it was.
  const setPlaylists = (given) => {
    const before = voiceOf(scene);
    let moved = false;
    for (const list of Object.values(lists)) {
      const wanted = (Array.isArray(given?.[list.key]) ? given[list.key] : [])
        .filter((track) => track && typeof track.src === "string" && track.src);
      const same = wanted.length === list.tracks.length
        && wanted.every((track, index) => track.src === list.tracks[index].src && track.id === list.tracks[index].id);
      if (same) { list.tracks = wanted; continue; }
      stopFade(list);
      if (list.audio && !list.audio.paused) list.audio.pause();
      Object.assign(list, { tracks: wanted, index: 0, misses: 0, dead: false, want: false, gain: 0 });
      if (list === before) moved = true;
    }
    if (moved || voiceOf(scene) !== before) revoice();
    else announce();
  };

  // The first sound of a session: whatever the scene is by then.
  const begin = () => {
    if (scene === "menu") { channels.passage.boost = 1; bring(channels.passage, FADE.menuIn); }
    else if (scene === "loading") toLoading();
    else settle();
  };

  return {
    setScene,
    setPlaylists,
    // Something the director depends on changed (the switch, the volume).
    sync: () => { for (const ch of everyChannel()) setVolume(ch); refresh(); },
    unlock: () => {
      if (unlocked) return;
      unlocked = true;
      // A game that began to open before this click: its entry was chosen for
      // the whole loading, and some of that is gone. Chosen again for what is
      // left, so the big hit still lands as the game appears.
      const passage = channels.passage;
      if (scene === "loading" && inDrama && !(passage.audio && !passage.audio.paused)) {
        Object.assign(passage, { want: false, gain: 0 });
        toLoading();
        return;
      }
      const idle = everyChannel().every((ch) => !ch.want);
      if (idle) begin();
      else refresh();
    },
    setHidden: (value) => { hidden = Boolean(value); refresh(); },
    setHeld: (value) => { held = Boolean(value); refresh(); },
    get scene() { return scene; },
    get unlocked() { return unlocked; },
    get cutAt() { return cutAt; },
    get inDrama() { return inDrama; },
    get expectedLoad() { return expectedLoadSeconds(loads); },
    get nowPlaying() { return playing; },
    channels,
    lists,
  };
};

// The scene, from what the game's screen knows (GameUI/main.jsx).
export const musicSceneOf = ({ inMenu = false, loading = false, atWar = false, war = false } = {}) => {
  if (inMenu) return "menu";
  if (loading) return "loading";
  if (war) return "war";
  return atWar ? "atWar" : "game";
};

// How long games took to open on this device, kept between sessions.
export const LOAD_SECONDS_KEY = "audio_load_seconds";
export const loadSecondsMemory = (win) => ({
  read: () => {
    try {
      const list = JSON.parse(win.localStorage.getItem(LOAD_SECONDS_KEY) ?? "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  },
  write: (list) => {
    try { win.localStorage.setItem(LOAD_SECONDS_KEY, JSON.stringify(list)); } catch { /* learned again next session */ }
  },
});

// The hub track that is sounding now, for whoever credits it (Settings →
// General → Sound): null while the game's own music plays, or none.
let nowPlaying = null;
const nowPlayingListeners = new Set();
export const getNowPlaying = () => nowPlaying;
export const subscribeNowPlaying = (listener) => {
  nowPlayingListeners.add(listener);
  return () => { nowPlayingListeners.delete(listener); };
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
    now: () => (typeof win.performance?.now === "function" ? win.performance.now() : Date.now()),
    memory: loadSecondsMemory(win),
    onNowPlaying: (track) => {
      nowPlaying = track;
      for (const listener of nowPlayingListeners) listener();
    },
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

// The open game's scenario music, resolved against the hub's list
// (scenarioMusic.js followScenarioMusic), or null for none.
export const setMusicPlaylists = (lists) => { started?.setPlaylists(lists); };

// Makes the music wait while something else is listened to (a track tried out
// in the scenario editor), and lets it carry on after.
export const holdMusic = (held) => { started?.setHeld(held); };
