import React, { useEffect, useRef, useState } from "react";
import { useWorldState } from "../Map/useWorldState.js";
import { SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT } from "../../runtime/mobileUi.js";
import {
  GAME_OPENING_EVENT,
  MAP_IDLE_EVENT,
  MAP_POLITIES_READY_EVENT,
  politiesReady,
  politiesSettled,
} from "../../runtime/mapReadiness.js";
import { useGameEntered } from "../../runtime/gameEntry.js";

// The screen a game opens under: the logo turning over a dark ground until the
// map has read the world, derived and drawn its borders and labels, and gone
// idle. Opening a game remounts the map and this UI (App.jsx keys both by the
// active game), so the hook starts fresh for every game. It comes up the moment
// the library starts opening a game (oh:game-opening, while the old UI is
// still mounted), stays until the polity layers are in for this game AND the
// map has gone idle since (runtime/mapReadiness.js stamps every mark with the
// game it was made for), and a hard ceiling makes sure a derivation that never
// answers cannot keep the player out.
//
// Nothing is opening until the player has opened a game (runtime/gameEntry.js):
// the page starts on the main menu with no map behind it, and this UI is
// mounted there all the same. So the wait starts when a game is entered, not
// when the hook mounts, and so does its ceiling: armed at mount, it would have
// run out under somebody who sat on the menu for a minute, and their first
// game would have opened with no cover at all.
const PHASES = {
  world: "Reading the world…",
  polities: "Drawing borders and labels…",
  settling: "Settling the map…",
  done: "",
};
export const LOADING_CEILING_MS = 60000;

export const useGameLoading = () => {
  const entered = useGameEntered();
  const { worldKnown } = useWorldState({ wait: !entered });
  const [phase, setPhase] = useState(() => (worldKnown && politiesSettled() ? "done" : "world"));
  const knownRef = useRef(worldKnown);
  useEffect(() => {
    knownRef.current = worldKnown;
  }, [worldKnown]);

  useEffect(() => {
    if (!entered) return undefined;
    let settled = false;
    const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    const finish = () => {
      if (settled) return;
      settled = true;
      setPhase("done");
    };
    const check = () => {
      if (settled || !knownRef.current) return;
      if (politiesSettled()) finish();
      else if (politiesReady()) setPhase((current) => (current === "done" ? current : "settling"));
    };
    // The status line moves on its own after a moment; the world read is quick.
    // Armed on every opening, so a redraw (the globe switched) gets its own
    // ceiling rather than whatever was left of the first one's.
    const arm = () => {
      later(() => setPhase((current) => (current === "world" ? "polities" : current)), 1200);
      later(finish, LOADING_CEILING_MS);
    };
    const reopen = () => {
      settled = false;
      timers.splice(0).forEach(clearTimeout);
      setPhase("world");
      arm();
      later(check, 0);
    };
    window.addEventListener(MAP_POLITIES_READY_EVENT, check);
    window.addEventListener(MAP_IDLE_EVENT, check);
    window.addEventListener(GAME_OPENING_EVENT, reopen);
    arm();
    // Deferred so signals that already fired are handled like live ones.
    later(check, 0);
    return () => {
      window.removeEventListener(MAP_POLITIES_READY_EVENT, check);
      window.removeEventListener(MAP_IDLE_EVENT, check);
      window.removeEventListener(GAME_OPENING_EVENT, reopen);
      timers.forEach(clearTimeout);
    };
  }, [entered]);

  // The world store hydrating is a signal too: a stock map is ready the moment
  // it is known to be one.
  useEffect(() => {
    if (!entered || !worldKnown || phase === "done") return undefined;
    const timer = setTimeout(() => {
      if (politiesSettled()) setPhase("done");
      else if (politiesReady()) setPhase((current) => (current === "done" ? current : "settling"));
    }, 0);
    return () => clearTimeout(timer);
  }, [entered, phase, worldKnown]);

  // Before a game is entered there is no map to wait for. (The cover is up all
  // the same between a press of Play and the game landing: GameUI/main.jsx
  // `awaitingGame`.)
  return { active: entered && phase !== "done", phase };
};

// The card image the library shows for a scenario with no cover of its own
// (libraryBar.jsx DEFAULT_SCENARIO_COVER): the screen keeps the same shape
// whether or not the scenario brought a picture.
const DEFAULT_COVER = "/scenario-placeholder.webp";
const textShadow = "0 2px 14px rgba(0,0,0,0.7)";

// The scenario's cover, full bleed, with the logo turning in the bottom corner
// and the name and status beside it on a flat dark strip: the picture is the
// screen, and the strip stays legible whatever the picture is.
// Ultra-clean cinematic layout: no heavy cards or chunky boxes.
// Floats majestic typography, subtle status, and the turning emblem in the lower third,
// letting the scenario artwork take center stage.
export const GameLoadingScreen = ({ gameName = "", scenarioName = "", countryName = "", coverUrl = "", phase = "world" }) => {
  const currentPhaseText = PHASES[phase] ?? PHASES.world;
  const progressPercent = phase === "world" ? 30 : phase === "polities" ? 65 : phase === "settling" ? 90 : 100;
  const title = gameName || scenarioName || "Open Historia";
  const subtitle = scenarioName && countryName && gameName !== scenarioName ? `${scenarioName} · ${countryName}` : countryName || scenarioName;

  return (
    <div
      className="oh-loading-screen"
      role="status"
      aria-live="polite"
      style={{
        background: "#08080a",
        color: "white",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        inset: 0,
        overflow: "hidden",
        position: "fixed",
        zIndex: 2147483200,
      }}
    >
      {/* Background artwork full bleed */}
      <div
        aria-hidden="true"
        style={{
          background: `url("${String(coverUrl || DEFAULT_COVER).replaceAll('"', "%22")}") center/cover no-repeat, `
            + `url("${DEFAULT_COVER}") center/cover no-repeat #08080a`,
          filter: "brightness(0.85) contrast(1.05)",
          inset: 0,
          position: "absolute",
        }}
      />

      {/* Soft ambient tint to ensure legibility across any artwork without gradients */}
      <div
        aria-hidden="true"
        style={{
          background: "rgba(5, 5, 8, 0.45)",
          inset: 0,
          position: "absolute",
        }}
      />

      {/* Centered Cinematic Presentation in lower third */}
      <div
        style={{
          alignItems: "center",
          bottom: `calc(3rem + ${SAFE_BOTTOM})`,
          display: "flex",
          flexDirection: "column",
          left: `calc(1rem + ${SAFE_LEFT})`,
          position: "absolute",
          right: `calc(1rem + ${SAFE_RIGHT})`,
          textAlign: "center",
          zIndex: 2,
        }}
      >
        {/* Emblem */}
        <div style={{ marginBottom: "1.25rem", position: "relative" }}>
          <img
            className="oh-loading-logo"
            src="/logo.png"
            alt=""
            style={{
              display: "block",
              filter: "drop-shadow(0 10px 30px rgba(0,0,0,0.8))",
              height: "3.75rem",
              width: "3.75rem",
            }}
          />
        </div>

        {/* Title */}
        <div
          style={{
            color: "#ffffff",
            fontSize: "1.75rem",
            fontWeight: 800,
            letterSpacing: "0.06em",
            lineHeight: 1.2,
            maxWidth: "90vw",
            textShadow: "0 4px 20px rgba(0,0,0,0.9)",
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>

        {/* Subtitle / Faction */}
        {subtitle && (
          <div
            style={{
              color: "rgba(255, 255, 255, 0.72)",
              fontSize: "0.95rem",
              fontWeight: 500,
              letterSpacing: "0.04em",
              marginTop: "0.4rem",
              textShadow: "0 2px 10px rgba(0,0,0,0.9)",
            }}
          >
            {subtitle}
          </div>
        )}

        {/* Razor-thin elegant progress line */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.15)",
            borderRadius: "999px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
            height: "2px",
            margin: "1.5rem auto 0.9rem",
            maxWidth: "380px",
            overflow: "hidden",
            width: "70vw",
          }}
        >
          <div
            style={{
              background: "#f5bd4f",
              boxShadow: "0 0 10px rgba(245, 189, 79, 0.7)",
              height: "100%",
              transition: "width 0.4s ease-out",
              width: `${progressPercent}%`,
            }}
          />
        </div>

        {/* Status Phase text */}
        <div
          style={{
            color: "rgba(255, 255, 255, 0.6)",
            fontSize: "0.72rem",
            fontWeight: 600,
            letterSpacing: "0.22em",
            textShadow: "0 2px 8px rgba(0,0,0,0.9)",
            textTransform: "uppercase",
          }}
        >
          {currentPhaseText}
        </div>
      </div>
    </div>
  );
};

export default GameLoadingScreen;
