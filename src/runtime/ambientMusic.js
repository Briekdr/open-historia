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
// And, having listened to the first version of it:
//   "its abruptly cutting to another part of the song when you open a new
//    game. I see the vision, but its a rough transition";
//   "if you're in the menu for like 30 seconds it just fades out and resets";
//   "if the game loads too fast it just abruptly stops the music".
//
// So the music follows where the player is (the SCENE):
//   menu     the menu and the screens before a game. Passage Of Time from its
//            start to the lull before its build (0 to 143.5 s), round and
//            round, LEVELLED: the gain follows the piece's own loudness
//            (calmGainAt), so its nearly inaudible opening is heard and its
//            loud plateau is no louder than the rest. The seam is where the
//            piece itself is all but silent, at both ends.
//   loading  a game is opening under its cover. The build comes in under the
//            menu's music and the two cross (PASSAGE_DRAMA.crossfade), at the
//            phrase from which the big hit lands just after the game is
//            expected to be drawn (entryFor), and it grows louder on the way
//            to the hit (boostAt).
//   game     the game is drawn. The music runs on at least to the big hit,
//            and to the next hit after it if that one has passed
//            (PASSAGE_DRAMA.cuts), lets it ring, and stops. After a breath of
//            silence the in-game piece comes in, when there is one. A game
//            drawn while the big hit is still far off does not wait for it:
//            the build fades out on its next accent (exitAfter).
//   atWar    in the game, with the player's troops on a battlefield. Whatever
//            the game plays, unless the scenario has music of its own for it.
//   war      the war room is open, or a battlefield is shown. Legionnaire,
//            then Vanguard, then Legionnaire again (MUSIC_WAR_PIECES): one
//            after the other, as a list plays.
//
// Passage Of Time plays on TWO elements of the one file: `calm` for the menu
// and `drama` for the build and the loud stretch. Going from one part of a
// piece to another on a single element is a cut, however short the dip around
// it; on two it is a crossfade. While the menu sounds, `drama` is made ready:
// loaded, silent and paused at the entry the next game opening would use. That
// is the one thing fetched before it is about to play, and only a little of it.
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
// unchanged. The times and the loudness in PASSAGE_CALM and PASSAGE_DRAMA were
// measured from the file: they belong to this recording and no other. A hub
// track's credit is the hub's (Settings shows the one that is playing).
//
// The rest:
//   * on unless the player turns it off (Settings → General → Sound), at a
//     volume they set there;
//   * nothing sounds before the player's first click, tap or key press,
//     because no browser lets a page make sound before one;
//   * a file is not asked for until it is about to play (but for `drama`,
//     above), and never while the music is off: a player who turns it off
//     downloads nothing;
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

// The menu's part of Passage Of Time, in seconds of the file: from its start
// to the lull before the build.
export const PASSAGE_CALM = Object.freeze({
  // The seam. At 140 to 145 the piece falls to near silence (quietest at 142
  // to 144), and its opening is as quiet: so it fades from `fadeFrom` to
  // nothing at `end`, goes back to 0, and comes in over `fadeIn` milliseconds,
  // where there is nothing to hear. It never plays past `limit`: the build
  // starts at 145.45.
  fadeFrom: 141.5,
  end: 143.5,
  limit: 144.5,
  fadeIn: 2500,
  // The piece's own loudness (RMS), one figure for every `step` seconds from
  // 0, each standing for the middle of its stretch: 0.029 is 0 to 5, heard as
  // the loudness at 2.5.
  step: 5,
  rms: Object.freeze([
    0.029, 0.033, 0.034, 0.035, 0.027, 0.050, 0.065, 0.044, 0.065, 0.051,
    0.064, 0.063, 0.058, 0.079, 0.100, 0.103, 0.113, 0.093, 0.128, 0.135,
    0.135, 0.132, 0.145, 0.127, 0.147, 0.104, 0.051, 0.066, 0.033,
  ]),
  // The levelling: the gain is (`level` / loudness) to the power `power`, kept
  // between `least` and `most`. A stretch as loud as `level` is left as it is;
  // the opening (0.03) is at the most, the plateau (0.14) at a little over half.
  level: 0.065,
  power: 0.75,
  least: 0.5,
  most: 1.6,
});

// Passage Of Time's build and its loud stretch, in seconds of the file.
export const PASSAGE_DRAMA = Object.freeze({
  // Where a game opening comes in: the starts of the build's phrases, each
  // just before an accent. Never later than the last of them, so even a game
  // that opens at once has four seconds of build before the big hit.
  entries: Object.freeze([145.3, 149.75, 157.3, 161.2, 164.7]),
  // How long the menu's music and the build take to cross, in milliseconds;
  // and how far before the entry the build starts playing, in seconds, so
  // that the middle of the crossing is the entry itself.
  crossfade: 1800,
  lead: 0.9,
  // The big hit that opens the full orchestra.
  hit: 168.6,
  // Just before it, so the hit is the first thing heard: where a game still
  // loading at the end of the loud stretch is taken back to.
  enter: 168.45,
  // Where the loud stretch ends: a game still loading by then goes round the
  // loud stretch again rather than on into the quiet ending.
  wrapAt: 226.4,
  // The big hit and the hits of the loud stretch. The music stops on the first
  // one that comes after the game is drawn: never before the big hit, so a
  // game that opens fast has the build carry on under its first seconds and
  // end on the hit, rather than be cut off as it began.
  cuts: Object.freeze([168.6, 174.3, 177.6, 186.4, 193.8, 198.1, 201.55, 206.9, 214.45, 222.05]),
  // How long a hit is let ring at full, in seconds, and how long the music
  // then takes to die away, in milliseconds (fast at first, then a long
  // tail). It was 0.35 s and 150 ms, which the owner heard as the piece being
  // cut off: an ending has to sound meant.
  ring: 0.5,
  stopFade: 3200,
  // For a guess that was badly wrong. A game drawn while the big hit is still
  // more than `softBeyond` seconds away does not run on for all that time: at
  // the next of the build's `accents` the music fades out over `softFade`
  // milliseconds. A soft exit, not a stop.
  accents: Object.freeze([149.9, 157.45]),
  softBeyond: 12,
  softFade: 1500,
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
const FADE = Object.freeze({ cross: 900, breath: 1500, gameIn: 3000 });
// How often the build is watched for its stop, and the menu for its levelling
// and the end of its part, which are in no hurry.
const TICK_MS = 25;
const CALM_TICK_MS = 200;
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

// How much the menu turns the piece up or down at `time`, so that it is
// evenly loud: from the piece's own loudness there, read between the table's
// figures so the gain glides and never steps. Before the middle of the first
// stretch and after the middle of the last it is theirs.
export const calmGainAt = (time, calm = PASSAGE_CALM) => {
  const { rms, step } = calm;
  const seconds = Number.isFinite(time) ? time : 0;
  const at = Math.max(0, Math.min(rms.length - 1, (seconds - step / 2) / step));
  const before = Math.floor(at);
  const after = Math.min(rms.length - 1, before + 1);
  const loudness = rms[before] + (rms[after] - rms[before]) * (at - before);
  return Math.max(calm.least, Math.min(calm.most, (calm.level / loudness) ** calm.power));
};

// When the music stops, for a game drawn at `time` in the file: just after the
// first hit still far enough ahead to be reached, and past the last of them at
// the end of the loud stretch, which is a stop of its own.
export const cutTimeAfter = (time, drama = PASSAGE_DRAMA) => {
  const hit = drama.cuts.find((cut) => cut + drama.ring > time + 0.1);
  return hit === undefined ? drama.wrapAt : hit + drama.ring;
};

// How the loading music ends, for a game drawn at `time` in the file:
// { at, soft }. With the big hit near enough it runs on to it (`at` is when it
// stops, after the hit has rung). With the hit still far off it fades out
// instead (`soft`), from the next accent of the build (`at`).
export const exitAfter = (time, drama = PASSAGE_DRAMA) => {
  if (drama.hit - time > drama.softBeyond) {
    const accent = drama.accents.find((at) => at >= time);
    if (accent !== undefined) return { at: accent, soft: true };
  }
  return { at: cutTimeAfter(time, drama), soft: false };
};

// Where a game opening comes into the build, for a game expected to take
// `expectedSeconds` to draw: the latest entry that still leaves that long, and
// the margin, before the big hit, so the hit lands just after the game
// appears. A game slower than the whole build comes in at its start; one that
// opens at once still comes in at the last entry, never later.
export const entryFor = (expectedSeconds, drama = PASSAGE_DRAMA) => {
  const expected = Number.isFinite(expectedSeconds) ? expectedSeconds : PASSAGE_LOADS.unknown;
  // To the millisecond: 168.6 - 164.7 is not quite 3.9 in floating point.
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
  // (the menu's levelling and the fade at its seam; the build's growth and
  // the loud stretch's).
  const channel = (track) => ({ track, audio: null, want: false, gain: 0, boost: 1, fade: null, startAt: null });
  // One channel a list: its tracks ({ id, src, … }), which one it is on, the
  // address its one element holds, how many in a row could not be played, and
  // whether none could (`dead`).
  const playlist = (key, items = []) => ({ key, tracks: items, index: 0, loaded: "", turn: 0, misses: 0, dead: false, audio: null, want: false, gain: 0, boost: 1, fade: null });
  // The game's own: Passage Of Time twice over (the menu's part and the
  // build, an element each, so one can cross into the other), the war room's
  // list of pieces, and the in-game piece.
  const channels = {
    calm: channel(tracks.passage),
    drama: channel(tracks.passage),
    war: playlist("war", warPieces.flatMap((name) => (tracks[name] ? [{ id: name, src: addressOf(tracks[name].file) }] : []))),
    game: channel(tracks.game),
  };
  const quiet = channels.calm;
  const loud = channels.drama;
  // A scenario's: one list a situation, of tracks as the hub's list resolved
  // them. One of these that cannot be played gives way to the game's own.
  const lists = Object.fromEntries(SCENARIO_MUSIC_SITUATIONS.map((key) => [key, playlist(key)]));
  const pieces = [quiet, loud, channels.game];
  const playlists = [channels.war, ...Object.values(lists)];
  const everyChannel = () => [...pieces, ...playlists];

  let scene = "menu";
  // A click, a tap or a key press has happened: sound is allowed.
  let unlocked = false;
  let hidden = false;
  // Something else is being listened to (a track tried out in the scenario
  // editor): the music waits.
  let held = false;
  // The build is playing (loading); where it came in, which its loudness
  // grows from (null: at the full boost); once the game is drawn, the time in
  // the file at which it ends, and whether that is a fade (a soft exit) or a
  // stop.
  let inDrama = false;
  let rampFrom = null;
  let cutAt = null;
  let softExit = false;
  // The entry the build is held ready at while the menu sounds, or null.
  let readyAt = null;
  // How many times the build, found playing far from where it was put, has
  // been put back since this game began to open.
  let strays = 0;
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

  // As loud as the player set it, times the channel's own gain and boost,
  // and never past full volume.
  const setVolume = (ch) => {
    if (!ch.audio) return;
    ch.audio.volume = Math.max(0, Math.min(1, (settings().volume / 100) * ch.gain * ch.boost));
  };

  // `preload` is "none" for a piece about to play (nothing is fetched before
  // play() asks for it) and "auto" for the build being made ready.
  const ensure = (ch, preload = "none") => {
    if (ch.audio || !ch.track) return ch.audio;
    ch.audio = makeAudio();
    ch.audio.preload = preload;
    ch.audio.loop = true;
    ch.audio.src = addressOf(ch.track.file);
    // Where it was told to be before it existed (a game opened before the
    // first click): a browser keeps this as where playing starts.
    if (ch.startAt !== null) { try { ch.audio.currentTime = ch.startAt; } catch { /* from the start, then */ } }
    ch.startAt = null;
    return ch.audio;
  };
  const seek = (ch, time) => {
    if (!ch.audio) { ch.startAt = time; return; }
    try { ch.audio.currentTime = time; } catch { /* a file not yet seekable plays from where it is */ }
  };
  const positionOf = (ch) => (ch.audio ? ch.audio.currentTime : ch.startAt ?? 0);

  // The menu's level at `time`: the levelling, and the fade to nothing at the
  // seam. By where the music is, not by the clock: silent at the end of its
  // part however the page's timers ran.
  const calmBoostAt = (time) => {
    const level = calmGainAt(time, calm);
    if (time < calm.fadeFrom) return level;
    return level * Math.max(0, (calm.end - time) / (calm.end - calm.fadeFrom));
  };

  // A list has something to play.
  const usable = (list) => list.tracks.length > 0 && !list.dead;

  // What a scene sounds like: the scenario's list for it when it has one that
  // plays, else the game's own music for it. At war with no list of its own
  // is whatever the game plays.
  const voiceOf = (where) => {
    if (where === "menu") return quiet;
    const own = where === "loading" ? lists.loading : where === "war" ? lists.battle : where === "atWar" ? lists.atWar : lists.game;
    if (usable(own)) return own;
    if (where === "atWar" && usable(lists.game)) return lists.game;
    return where === "loading" ? loud : where === "war" ? channels.war : channels.game;
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

  const stopFade = (ch) => { if (ch.fade !== null) { timers.clear(ch.fade); ch.fade = null; } };

  // The build made ready while the menu sounds: its element made, told to
  // load, and held silent and paused at the entry the next game opening would
  // use, so that opening crosses onto music that is already there. Aimed
  // again when the expected load time, and so the entry, has changed. Only
  // while the music is on and sound is allowed: it does fetch a little of the
  // file.
  const readyDrama = () => {
    if (!loud.track || loud.want) return;
    const entry = entryFor(expectedLoadSeconds(loads), drama);
    if (loud.audio && readyAt === entry) return;
    ensure(loud, "auto");
    loud.audio.preload = "auto";
    stopFade(loud);
    loud.gain = 0;
    loud.boost = 1;
    setVolume(loud);
    seek(loud, entry);
    readyAt = entry;
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
    if (on && scene === "menu" && quiet.want) readyDrama();
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

  // Moves a channel's loudness to `gain` over `ms`, then calls `then`. One
  // already there is there at once. With `equalPower` the way up follows a
  // sine and the way down a cosine, so that two channels crossing are as loud
  // together, all the way, as either is alone: a straight line each would dip
  // in the middle. With "decay" the way down is fast at first and then long,
  // as a struck note dies away: for the loading music's end.
  const fadeTo = (ch, gain, ms, then = null, equalPower = false) => {
    stopFade(ch);
    const from = ch.gain;
    const steps = Math.max(1, Math.round(ms / FADE_STEP_MS));
    let done = 0;
    const step = () => {
      done += 1;
      const part = done / steps;
      const shaped = equalPower === "decay" ? 1 - (1 - part) ** 2
        : !equalPower ? part : gain >= from ? Math.sin(part * Math.PI / 2) : 1 - Math.cos(part * Math.PI / 2);
      ch.gain = done < steps ? from + (gain - from) * shaped : gain;
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
  // The menu's music in, from where it is (its start, unless it was still
  // going out under a game that began to open), at the level of that place.
  const bringCalm = () => {
    if (!quiet.want) quiet.boost = calmBoostAt(positionOf(quiet));
    bring(quiet, calm.fadeIn);
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

  // The menu's music still going out under a game that began to open:
  // levelled to the last, and stopped at the end of its part should it get
  // there before the crossing is over.
  const tendCalm = () => {
    const audio = quiet.audio;
    if (!quiet.want || !audio || audio.paused) return;
    const time = audio.currentTime;
    if (time < calm.end) {
      const boost = calmBoostAt(time);
      if (boost !== quiet.boost) { quiet.boost = boost; setVolume(quiet); }
      return;
    }
    stopFade(quiet);
    quiet.want = false;
    quiet.gain = 0;
    audio.pause();
    seek(quiet, 0);
  };

  // What the watch below is for: on the menu, the levelling and the end of
  // the menu's part; while a game opens, the build's growth, the wrap, and
  // how it ends.
  const watching = () => (scene === "menu" ? quiet.want : inDrama || cutAt !== null);
  const stopTick = () => { if (tick !== null) { timers.clear(tick); tick = null; } };
  const startTick = () => {
    if (tick !== null) return;
    const beat = () => {
      tick = null;
      if (!audible() || !watching()) return;
      if (scene === "menu") {
        const audio = quiet.audio;
        if (!audio) return;
        const time = audio.currentTime;
        if (time >= calm.end) {
          // The end of its part, in silence: from the top again.
          seek(quiet, 0);
          quiet.boost = calmBoostAt(0);
          quiet.gain = 0;
          setVolume(quiet);
          fadeTo(quiet, 1, calm.fadeIn);
          tick = timers.set(beat, CALM_TICK_MS);
          return;
        }
        const boost = calmBoostAt(time);
        if (boost !== quiet.boost) { quiet.boost = boost; setVolume(quiet); }
        // Slowly until the fade at the seam, then at a fade's pace; and the
        // next look is never later than where the fade begins, or the end.
        const dying = time >= calm.fadeFrom;
        const left = ((dying ? calm.end : calm.fadeFrom) - time) * 1000;
        tick = timers.set(beat, Math.max(1, Math.min(dying ? FADE_STEP_MS : CALM_TICK_MS, left)));
        return;
      }
      const audio = loud.audio;
      if (!audio) return;
      tendCalm();
      const time = audio.currentTime;
      // Nowhere near the build: a browser that did not keep where an element
      // was told to start (some do not, on one that has never played) would
      // be playing the piece's opening here. Put where it belongs once it
      // knows its file (before that it cannot be moved), a few times at
      // most: an element that will not be moved is left to play.
      if (time < drama.entries[0] - drama.lead - 1 && strays < 3) {
        if (audio.readyState === undefined || audio.readyState >= 1) {
          strays += 1;
          seek(loud, rampFrom ?? drama.enter);
        }
        tick = timers.set(beat, TICK_MS);
        return;
      }
      if (cutAt !== null && time >= cutAt) { leave(softExit ? drama.softFade : drama.stopFade, softExit ? false : "decay"); return; }
      // Still loading at the end of the loud stretch: round it again, as loud.
      if (time >= drama.wrapAt) { seek(loud, drama.enter); rampFrom = null; }
      const boost = boostAt(audio.currentTime, rampFrom, drama);
      if (boost !== loud.boost) { loud.boost = boost; setVolume(loud); }
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

  // The loading music ends: over `ms`, dying away after a hit has rung (a
  // stop that was only a moment long sounded like the piece being cut off
  // "at some point in the song", the owner's words), or evenly for a soft
  // exit. Then nothing, for a breath, and then the scene's own music.
  const leave = (ms, shape = false) => {
    cutAt = null;
    softExit = false;
    inDrama = false;
    rampFrom = null;
    stopTick();
    fadeTo(loud, 0, ms, () => {
      loud.want = false;
      loud.boost = 1;
      refresh();
      breath = timers.set(() => { breath = null; settle(); }, FADE.breath);
    }, shape);
  };

  const toMenu = () => {
    clearBreath();
    cutAt = null;
    softExit = false;
    inDrama = false;
    rampFrom = null;
    silence(channels.game, FADE.cross);
    silence(loud, FADE.cross);
    for (const list of playlists) {
      silence(list, FADE.cross);
      // A list that could not be played is tried again in the next game.
      list.dead = false;
      list.misses = 0;
    }
    bringCalm();
  };

  // How much longer the game now opening is expected to take.
  const loadLeft = () => {
    const spent = loadingSince === null ? 0 : (clock() - loadingSince) / 1000;
    return Math.max(0, expectedLoadSeconds(loads) - spent);
  };

  const toLoading = () => {
    clearBreath();
    cutAt = null;
    softExit = false;
    const voice = voiceOf("loading");
    if (voice !== loud) {
      // The scenario's own loading music: no build and no stop on a hit. It
      // fades out when the game is drawn, like any list.
      inDrama = false;
      rampFrom = null;
      silence(quiet, FADE.cross, { rewind: true });
      silence(loud, FADE.cross);
      sound(voice);
      return;
    }
    for (const other of [channels.game, ...playlists]) silence(other, FADE.cross);
    // The menu's music is sounding: the build starts a little before its
    // entry, under it, and the two cross, so that the middle of the crossing
    // is the entry. Nothing to cross with (the first click came while the
    // game was opening): the build comes in from the entry itself.
    const crossing = quiet.want && quiet.gain > 0 && audible();
    const entry = entryFor(loadLeft(), drama);
    const from = crossing ? entry - drama.lead : entry;
    inDrama = true;
    rampFrom = entry;
    readyAt = null;
    strays = 0;
    stopFade(loud);
    loud.want = true;
    loud.gain = 0;
    loud.boost = boostAt(from, entry, drama);
    seek(loud, from);
    refresh();
    fadeTo(loud, 1, drama.crossfade, null, true);
    if (crossing) {
      fadeTo(quiet, 0, drama.crossfade, () => {
        quiet.want = false;
        seek(quiet, 0);
        refresh();
      }, true);
    } else {
      silence(quiet, FADE.cross, { rewind: true });
    }
  };

  // The game is drawn (in it, or in it at war).
  const toPlay = () => {
    const sounding = loud.want && loud.audio && !loud.audio.paused && audible();
    if (inDrama && sounding) {
      // Runs on to the big hit, or the next one, and stops there; or, with
      // the big hit still far off, to the build's next accent, and fades out.
      const exit = exitAfter(loud.audio.currentTime, drama);
      cutAt = exit.at;
      softExit = exit.soft;
      startTick();
      return;
    }
    // Nothing dramatic to end: the menu's music fades, and the game's comes in.
    inDrama = false;
    rampFrom = null;
    cutAt = null;
    softExit = false;
    silence(quiet, FADE.cross, { rewind: true });
    silence(loud, FADE.cross);
    settle();
  };

  const toWar = () => {
    // The war room does not wait for a hit: the loading music stops now.
    if (inDrama || cutAt !== null) {
      cutAt = null;
      softExit = false;
      inDrama = false;
      rampFrom = null;
      stopTick();
    }
    silence(loud, FADE.cross);
    silence(quiet, FADE.cross, { rewind: true });
    settle();
  };

  const enter = { menu: toMenu, loading: toLoading, game: toPlay, atWar: toPlay, war: toWar };
  const inPlay = (where) => where === "game" || where === "atWar";

  // The scene's voice is another than it was (the scenario's lists arrived or
  // changed, or one of them could not be played): what sounds follows. The
  // loading music on its way to its end, or the breath after it, is left to
  // finish; it ends in settle().
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
    // is still running to its end, the game's comes in after it as it would.
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
    if (scene === "menu") bringCalm();
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
      if (scene === "loading" && inDrama && !(loud.audio && !loud.audio.paused)) {
        Object.assign(loud, { want: false, gain: 0 });
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
    get softExit() { return softExit; },
    get inDrama() { return inDrama; },
    get readyAt() { return readyAt; },
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
