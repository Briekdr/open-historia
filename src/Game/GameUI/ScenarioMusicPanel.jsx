/*! Open Historia — the scenario editor's Music tab © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The tracks a scenario plays in each of four situations of a game: while it
// opens, in it, in it at war, and in the war room (server/scenarioMusic.js).
// They are chosen from the community hub's music list and from nowhere else:
// only the hub's contributors can add to that list, which is how every track
// on it is one the hub may share, so there is no upload here and no address to
// type. The scenario keeps the tracks' ids; their names, credits and files are
// the hub's (runtime/hubMusic.js).
//
// Each situation has its list, in the order it plays (move up, move down,
// remove), and "Add a track" opens the hub's list under it: searched by name
// or composer, the tracks said to suit the situation first, each with a
// preview. A preview plays from the address the game itself would play the
// track from, one at a time, and the game's own music waits while it does.
//
// Nothing is saved from here: the lists are part of the editor's form, and its
// Save writes them with the rest of the scenario.

import React, { useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_MUSIC_VOLUME, holdMusic, musicVolume } from "../../runtime/ambientMusic.js";
import { HUB_MUSIC_TEXTS, offeredTracks, playableAddressOf, trackById } from "../../runtime/hubMusic.js";
import { useTouchPrimary } from "../../runtime/mobileUi.js";
import {
  MAX_SCENARIO_MUSIC_TRACKS,
  MUSIC_SITUATION_LABELS,
  SCENARIO_MUSIC_SITUATIONS,
  creditSiteOf,
  normalizeScenarioMusic,
  scenarioMusicCredits,
  scenarioMusicTrackIds,
} from "../../runtime/scenarioMusic.js";
import { useHubMusic } from "../../runtime/useHubMusic.js";

const cardStyle = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  marginBottom: "0.95rem",
  padding: "0.9rem",
};
const buttonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "rgba(246,246,248,0.92)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.76rem",
  fontWeight: 700,
  gap: "0.35rem",
  justifyContent: "center",
  minHeight: "2rem",
  padding: "0 0.8rem",
};
const iconButtonStyle = { ...buttonStyle, flex: "0 0 auto", minWidth: "2rem", padding: 0 };
// A little brighter than its neighbours, and still grey: no blue buttons here.
const primaryButtonStyle = { ...buttonStyle, background: "rgba(255,255,255,0.14)", borderColor: "rgba(255,255,255,0.3)", color: "#ffffff" };
const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px",
  boxSizing: "border-box",
  color: "#f8fafc",
  fontFamily: "inherit",
  fontSize: "0.8rem",
  outline: "none",
  padding: "0.6rem 0.66rem",
  width: "100%",
};
const quietStyle = { color: "rgba(255,255,255,0.58)", fontSize: "0.76rem", lineHeight: 1.5 };
const rowStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "12px",
  display: "flex",
  gap: "0.5rem",
  padding: "0.45rem 0.55rem",
};
const trackNameStyle = { fontSize: "0.84rem", fontWeight: 700, overflowWrap: "anywhere" };
const trackDetailStyle = { color: "rgba(255,255,255,0.58)", fontSize: "0.72rem", overflowWrap: "anywhere" };

// On a touch screen .oh-tap / .oh-tap-row (styles.css) make a control a
// finger's size; the inline minimum would hold it smaller.
const touchFit = (style, touch) => (touch ? { ...style, minHeight: undefined, minWidth: undefined } : style);

// How many of the hub's tracks the list under "Add a track" shows at once.
// The sentence under a longer list says this number, and the one for a full
// situation says MAX_SCENARIO_MUSIC_TRACKS: each is written out whole, so a
// language pack holds it as one sentence, and changes with its number.
const PICKER_ROWS = 200;

const Chevron = ({ up = false }) => (
  <svg aria-hidden="true" fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" width="12">
    <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
  </svg>
);
const PlayGlyph = ({ playing }) => (
  <svg aria-hidden="true" fill="currentColor" height="11" viewBox="0 0 24 24" width="11">
    {playing ? <path d="M6 5h12v14H6z" /> : <path d="M7 4l13 8-13 8z" />}
  </svg>
);

// A track's length as minutes and seconds, or "" when the hub did not say.
const lengthOf = (seconds) => (seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "");
// Composer, licence and length on one line: names and numbers, never translated.
const detailOf = (track) => [track.artist, track.licence, lengthOf(track.seconds)].filter(Boolean).join(" · ");

// One track tried out at a time, on an <audio> of its own, played from the
// address the game plays the track from. The game's music waits meanwhile
// (ambientMusic.js holdMusic) and carries on when the preview stops, ends,
// fails, or this tab goes away.
const useTrackPreview = () => {
  const audioRef = useRef(null);
  // Which preview is the newest: what an older one reports is dropped.
  const turnRef = useRef(0);
  const [playingId, setPlayingId] = useState("");
  const [failedId, setFailedId] = useState("");

  const finish = (turn, failedTrackId = "") => {
    if (turn !== turnRef.current) return;
    turnRef.current += 1;
    audioRef.current?.pause();
    setPlayingId("");
    if (failedTrackId) setFailedId(failedTrackId);
    holdMusic(false);
  };
  const stop = () => finish(turnRef.current);
  const play = (track) => {
    turnRef.current += 1;
    const turn = turnRef.current;
    setFailedId("");
    const src = playableAddressOf(track);
    if (!src) { finish(turn, track.id); return; }
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "none";
    }
    const audio = audioRef.current;
    audio.onended = () => finish(turn);
    audio.onerror = () => finish(turn, track.id);
    audio.src = src;
    // As loud as the game's music is set, or as it is by default when that is
    // silent: a preview somebody pressed is meant to be heard.
    audio.volume = (musicVolume() || DEFAULT_MUSIC_VOLUME) / 100;
    setPlayingId(track.id);
    holdMusic(true);
    const started = audio.play();
    // Given another track, or stopped, before it began: not a failure.
    if (started && typeof started.catch === "function") started.catch((error) => { if (error?.name !== "AbortError") finish(turn, track.id); });
  };

  useEffect(() => () => {
    turnRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    holdMusic(false);
  }, []);

  return { failedId, playingId, stop, toggle: (track) => (playingId === track.id ? stop() : play(track)) };
};

// The credits of a scenario's tracks, as their licences ask: under the
// scenario's name before a game is started, and under the Music tab's lists.
// Nothing at all for a scenario that names no track, or while the hub's list
// is not known; and the list is only asked for when there is a track to credit.
export const ScenarioMusicCredits = ({ music, style = null }) => {
  const named = scenarioMusicTrackIds(music).length > 0;
  const list = useHubMusic(named);
  const credits = named && list?.listed ? scenarioMusicCredits(music, list) : [];
  if (!credits.length) return null;
  return (
    <div style={{ ...quietStyle, overflowWrap: "anywhere", ...style }}>
      <div>{"Music:"}</div>
      {credits.map((entry) => {
        const site = creditSiteOf(entry.source);
        return (
          <div key={entry.id}>
            <span data-no-translate>{entry.credit}</span>
            {site && " "}
            {site && (
              <a data-no-translate href={entry.source} rel="noopener noreferrer" style={{ color: "inherit" }} target="_blank">{site}</a>
            )}
          </div>
        );
      })}
    </div>
  );
};

// A track the scenario plays, in its place in a situation's list.
const ChosenRow = ({ entry, index, count, track, listed, onMove, onRemove, touch }) => {
  // On the hub's list and still there. A track the list no longer has, or has
  // taken down, is said to be gone; with no list to ask, only its id is known.
  const there = Boolean(track) && !track.removed;
  return (
    <div style={rowStyle}>
      <span data-no-translate style={{ ...trackDetailStyle, flex: "0 0 auto", minWidth: "1.1rem", textAlign: "right" }}>{index + 1}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div data-no-translate style={trackNameStyle}>{there ? track.name : entry.id}</div>
        {there && detailOf(track) ? <div data-no-translate style={trackDetailStyle}>{detailOf(track)}</div> : null}
        {!there && listed ? <div style={{ color: "#fde68a", fontSize: "0.72rem" }}>{"No longer on the hub"}</div> : null}
      </div>
      <button aria-label="Move up" className="oh-tap" disabled={index === 0} onClick={() => onMove(-1)} style={touchFit({ ...iconButtonStyle, opacity: index === 0 ? 0.4 : 1 }, touch)} type="button"><Chevron up /></button>
      <button aria-label="Move down" className="oh-tap" disabled={index === count - 1} onClick={() => onMove(1)} style={touchFit({ ...iconButtonStyle, opacity: index === count - 1 ? 0.4 : 1 }, touch)} type="button"><Chevron /></button>
      <button className="oh-tap-row" onClick={onRemove} style={touchFit(buttonStyle, touch)} type="button">{"Remove"}</button>
    </div>
  );
};

// The hub's tracks, under the situation a track is being added to.
const TrackPicker = ({ situation, list, full, preview, onAdd, onClose, touch }) => {
  const [query, setQuery] = useState("");
  const tracks = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const found = offeredTracks(list).filter((track) => !wanted || `${track.name} ${track.artist}`.toLowerCase().includes(wanted));
    // The tracks said to suit this situation first, each group in the hub's order.
    return [...found.filter((track) => track.fits.includes(situation)), ...found.filter((track) => !track.fits.includes(situation))];
  }, [list, query, situation]);
  const offered = offeredTracks(list).length;

  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", display: "grid", gap: "0.45rem", marginTop: "0.7rem", paddingTop: "0.7rem" }}>
      <div style={{ alignItems: "center", display: "flex", gap: "0.45rem" }}>
        <input
          aria-label="Search by name or composer"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or composer"
          style={inputStyle}
          value={query}
        />
        <button className="oh-tap-row" onClick={onClose} style={touchFit(buttonStyle, touch)} type="button">{"Close"}</button>
      </div>
      {full ? <div style={{ ...quietStyle, color: "#fde68a" }}>{"A situation holds at most 12 tracks."}</div> : null}
      {offered === 0 ? <div style={quietStyle}>{"The hub's music list has no tracks yet."}</div> : null}
      {offered > 0 && tracks.length === 0 ? <div style={quietStyle}>{"No track matches the search."}</div> : null}
      <div style={{ display: "grid", gap: "0.35rem", maxHeight: "18rem", overflowY: "auto" }}>
        {tracks.slice(0, PICKER_ROWS).map((track) => {
          const playing = preview.playingId === track.id;
          return (
            <div key={track.id} style={rowStyle}>
              <button
                aria-label={playing ? "Stop the preview" : "Play a preview"}
                aria-pressed={playing}
                className="oh-tap"
                onClick={() => preview.toggle(track)}
                style={touchFit(playing ? { ...iconButtonStyle, background: "rgba(255,255,255,0.2)", borderColor: "rgba(255,255,255,0.4)", color: "#ffffff" } : iconButtonStyle, touch)}
                title={playing ? "Stop the preview" : "Play a preview"}
                type="button"
              >
                <PlayGlyph playing={playing} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div data-no-translate style={trackNameStyle}>{track.name}</div>
                {detailOf(track) ? <div data-no-translate style={trackDetailStyle}>{detailOf(track)}</div> : null}
                {preview.failedId === track.id ? <div style={{ color: "#fecaca", fontSize: "0.72rem" }}>{"This track could not be played."}</div> : null}
              </div>
              <button className="oh-tap-row" disabled={full} onClick={() => onAdd(track)} style={touchFit({ ...primaryButtonStyle, opacity: full ? 0.55 : 1 }, touch)} type="button">{"Add"}</button>
            </div>
          );
        })}
      </div>
      {tracks.length > PICKER_ROWS ? <div style={quietStyle}>{"Showing the first 200 tracks. Search to find the rest."}</div> : null}
    </div>
  );
};

// `music` is the form's record (normalizeScenarioMusic: four lists, or null
// for none) and `onChange` takes the next one, read the same way.
const ScenarioMusicPanel = ({ music, onChange }) => {
  const touch = useTouchPrimary();
  const list = useHubMusic();
  const preview = useTrackPreview();
  // The situation whose "Add a track" list is open, one at a time.
  const [adding, setAdding] = useState("");
  const listed = Boolean(list?.listed);

  const entriesOf = (situation) => music?.[situation] ?? [];
  const write = (situation, entries) => onChange(normalizeScenarioMusic({
    ...Object.fromEntries(SCENARIO_MUSIC_SITUATIONS.map((key) => [key, entriesOf(key)])),
    [situation]: entries,
  }));
  const move = (situation, index, by) => {
    const entries = [...entriesOf(situation)];
    const [entry] = entries.splice(index, 1);
    entries.splice(index + by, 0, entry);
    write(situation, entries);
  };
  // The picker closing, or another opening, stops what was being tried out.
  const openPicker = (situation) => {
    preview.stop();
    setAdding(situation);
  };

  return (
    <>
      <div style={cardStyle}>
        <div style={{ color: "rgba(255,255,255,0.92)", fontSize: "0.92rem", fontWeight: 800, marginBottom: "0.2rem" }}>{"Music"}</div>
        <div style={quietStyle}>{"Scenario music comes from the community hub's list, which only its contributors can add to, so that every track is one the hub may share."}</div>
        <div style={{ ...quietStyle, marginTop: "0.3rem" }}>{"A situation with no tracks plays the game's own music."}</div>
        {list === null ? <div style={{ ...quietStyle, marginTop: "0.3rem" }}>{"Loading the hub's music list…"}</div> : null}
        {list !== null && !listed ? <div role="status" style={{ ...quietStyle, color: "#fde68a", marginTop: "0.3rem" }}>{HUB_MUSIC_TEXTS.unread}</div> : null}
      </div>

      {SCENARIO_MUSIC_SITUATIONS.map((situation) => {
        const entries = entriesOf(situation);
        const full = entries.length >= MAX_SCENARIO_MUSIC_TRACKS;
        return (
          <div key={situation} style={cardStyle}>
            <div style={{ alignItems: "baseline", display: "flex", gap: "0.6rem", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <div style={{ color: "rgba(255,255,255,0.92)", fontSize: "0.88rem", fontWeight: 800 }}>{MUSIC_SITUATION_LABELS[situation]}</div>
              <div data-no-translate style={trackDetailStyle}>{`${entries.length} / ${MAX_SCENARIO_MUSIC_TRACKS}`}</div>
            </div>
            {entries.length === 0 ? (
              <div style={{ ...quietStyle, marginBottom: "0.5rem" }}>
                {situation === "atWar" ? "No tracks chosen: the music does not change when the player is at war." : "No tracks chosen: the game's own music plays."}
              </div>
            ) : (
              <div style={{ display: "grid", gap: "0.35rem", marginBottom: "0.5rem" }}>
                {entries.map((entry, index) => (
                  <ChosenRow
                    count={entries.length}
                    entry={entry}
                    index={index}
                    key={`${entry.id}-${index}`}
                    listed={listed}
                    onMove={(by) => move(situation, index, by)}
                    onRemove={() => write(situation, entries.filter((_, at) => at !== index))}
                    touch={touch}
                    track={listed ? trackById(list, entry.id) : null}
                  />
                ))}
              </div>
            )}
            {adding === situation ? (
              <TrackPicker
                full={full}
                list={list}
                onAdd={(track) => write(situation, [...entries, { id: track.id, version: track.version }])}
                onClose={() => openPicker("")}
                preview={preview}
                situation={situation}
                touch={touch}
              />
            ) : (
              <button className="oh-tap-row" disabled={!listed || full} onClick={() => openPicker(situation)} style={touchFit({ ...buttonStyle, opacity: !listed || full ? 0.55 : 1 }, touch)} type="button">{"Add a track"}</button>
            )}
          </div>
        );
      })}

      <ScenarioMusicCredits music={music} style={{ ...cardStyle, color: quietStyle.color }} />
    </>
  );
};

export default ScenarioMusicPanel;
