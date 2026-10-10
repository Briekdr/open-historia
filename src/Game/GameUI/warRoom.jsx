/*! Open Historia — the war room © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war room opens from the red button that appears while the player's
// troops are on a battlefield (main.jsx). While it is open it is the whole of
// the screen: every other control is put out of sight, the map is fitted to the
// battlefield inside a frame of plate steel, and a panel of the same plate
// stands on the right (warRoomTheme.js). In the panel are
//
//   - a tab a battlefield, when the player is fighting on more than one;
//   - the KEY: the player's generals, each with the body of troops he commands
//     (runtime/fronts/command.js). Pointing at a general lights his troops on
//     the map; "Pick" picks them out;
//   - the TOOLS for the troops picked out: a box dragged on the map picks
//     them, and they are sent along a route drawn for them, or told to dig in,
//     hold or fall back, or given back to their stretch of line;
//   - the PLANS: every movement the player's side means to make, drawn on the
//     map as an arrow before it is made (runtime/fronts/plans.js): his routes,
//     his generals' orders, the Board's operations (each can be redrawn, or
//     told to move nothing), and diversions; and under them what his agents
//     and his Board have of the other side's;
//   - the TALK with the generals: one request a message (AI/gameplay.js
//     generateWarRoomReply). They answer, push back, and take orders.
//
// Nothing moves while the war room is open. What is ordered here is put to
// the troops when time next passes (runtime/fronts/engine.js). Every change
// goes through runtime/warRoomWrites.js.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateWarRoomReply } from "../AI/gameplayLazy.js";
import { warRoomIntel, warRoomPlans } from "../AI/frontPlans.js";
import { isSimulationBusy } from "../AI/simulationStatus.js";
import { closeWarRoom, getWarRoom, onWarRoomWay, openWarRoom, setWarRoom, showBattlefield, takeTool, useWarRoom } from "../Map/warRoomStore.js";
import { PLAN_COLOURS, planTone } from "../Map/warRoomGeometry.js";
import { readFrontCities } from "../../runtime/frontCities.js";
import { chosenOrdersOf, commandTitle, generalsOf, talkOf } from "../../runtime/fronts/command.js";
import { THRUST_TROOPS } from "../../runtime/fronts/constants.js";
import { foldBattlefieldName, normalizeBattlefield } from "../../runtime/fronts/record.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { isActiveFeatureEnabled, useActiveFeatures } from "../../runtime/gameFeatures.js";
import { useLibraryState } from "../../runtime/library.js";
import { SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { sendWarRoomOp } from "../../runtime/warRoomWrites.js";
import { ADVISOR_SLIDE } from "./advisorSlide.js";
import { placeName, playerFronts } from "./warRoomData.js";
import {
  AMBER,
  BONE,
  BONE_FAINT,
  BONE_SOFT,
  BRASS,
  OLIVE,
  OLIVE_LINE,
  RED,
  RED_BRIGHT,
  RED_DARK,
  STEEL,
  STENCIL,
  keyStyle,
  linkStyle,
  plateStyle,
  rivetStyle,
  stencilStyle,
  trayStyle,
} from "./warRoomTheme.js";
import { useTurnRunning } from "./useTurnRunning.js";

const WAR_ROOM_WIDTH = "min(26rem, calc(100vw - 1rem))";
// The frame of plate round the map: a bar across the top with the
// battlefield's name on it, and a strip down the left and along the bottom.
const FRAME_BAR = "2.2rem";
const FRAME_STRIP = "0.55rem";

const selectWorld = (world) => world ?? null;
const selectGame = (game) => ({
  country: game?.country || "",
  gameDate: String(game?.gameDate || game?.startDate || ""),
  humanCountries: Array.isArray(game?.humanCountries) ? game.humanCountries : null,
});

// What an order is called on the panel.
const OrderWord = ({ order }) => {
  if (order === "advance") return <>Advance</>;
  if (order === "blitz") return <>Blitz</>;
  if (order === "spearhead") return <>Spearhead</>;
  if (order === "flank") return <>Flank</>;
  if (order === "encircle") return <>Encircle</>;
  if (order === "hold") return <>Hold</>;
  if (order === "dig in") return <>Dig in</>;
  if (order === "fall back") return <>Fall back</>;
  return <>Order</>;
};

// What a general's troops are at, as the engine's brief has it.
const DoingWord = ({ doing }) => {
  if (doing === "advancing" || doing === "advance") return <>advancing</>;
  if (doing === "dug-in") return <>dug in</>;
  if (doing === "cut-off") return <>cut off</>;
  if (doing === "on-route") return <>following a route</>;
  if (doing === "closing") return <>closing on a pocket</>;
  if (doing === "assaulting") return <>assaulting</>;
  if (doing === "falling-back") return <>falling back</>;
  if (doing === "breaking-out") return <>breaking out</>;
  if (doing === "pursuing") return <>pursuing</>;
  if (doing === "spearhead") return <>driving a spearhead</>;
  if (doing === "encircle") return <>encircling</>;
  if (doing === "flank") return <>turning a flank</>;
  if (doing === "blitz") return <>massing to attack</>;
  return <>holding the line</>;
};

const ProjectStatus = ({ status }) => {
  if (status === "active") return <>under way</>;
  if (status === "proposed") return <>proposed</>;
  if (status === "paused") return <>paused</>;
  if (status === "stalled") return <>stalled</>;
  return null;
};

// A heading stencilled on the plate, ruled off to the right.
const Heading = ({ children, action = null, style = null }) => (
  <div style={{ alignItems: "center", display: "flex", gap: "0.55rem", ...style }}>
    <div style={stencilStyle}>{children}</div>
    <div aria-hidden="true" style={{ background: "rgba(201,165,76,0.3)", flex: 1, height: "1px" }} />
    {action}
  </div>
);

// A general's number, as it is stamped on his tag.
const Tag = ({ number, lit }) => (
  <span aria-hidden="true" style={{
    alignItems: "center", background: lit ? BRASS : "rgba(0,0,0,0.45)", border: `1px solid ${BRASS}`, borderRadius: "2px", color: lit ? "#1c1608" : BRASS,
    display: "inline-flex", flex: "0 0 auto", fontFamily: STENCIL, fontSize: "0.86rem", fontWeight: 700, height: "1.5rem", justifyContent: "center", width: "1.5rem",
  }}>{number}</span>
);

const softText = { color: BONE_SOFT, fontSize: "0.72rem", lineHeight: 1.4 };

const WarRoomPanel = ({ open, onClose, width, onResize, onResizeEnd }) => {
  const isMobile = useIsMobile();
  // (Read through the hook so that a switch thrown in the game's settings is seen.)
  useActiveFeatures();
  const espionage = isActiveFeatureEnabled("espionage");
  const world = useRuntimeState("world", selectWorld);
  const game = useRuntimeState("game", selectGame);
  const { activeGame } = useLibraryState();
  const turnRunning = useTurnRunning(open);
  const shown = useWarRoom((state) => state.battlefield);
  const tool = useWarRoom((state) => state.tool);
  const replan = useWarRoom((state) => state.replan);
  const selected = useWarRoom((state) => state.selected);
  const highlight = useWarRoom((state) => state.highlight);
  const pointed = useWarRoom((state) => state.pointed);

  // ---- which battlefield ---------------------------------------------------------------
  const fronts = useMemo(() => playerFronts(world?.battlefields, game.country), [world?.battlefields, game.country]);
  const front = fronts.find((entry) => foldBattlefieldName(entry.name) === foldBattlefieldName(shown)) ?? fronts[0] ?? null;
  const record = useMemo(() => {
    if (!front) return null;
    const row = world.battlefields.find((entry) => foldBattlefieldName(entry?.name) === foldBattlefieldName(front.name));
    return row ? normalizeBattlefield(row) : null;
  }, [world?.battlefields, front]);
  const side = front?.side ?? -1;

  // The store follows the panel: open on the battlefield shown, shut with it.
  useEffect(() => {
    if (!open || !front) return undefined;
    openWarRoom(front.name, front.side);
    return () => closeWarRoom();
    // Opened once per opening: a change of battlefield goes through showBattlefield.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, Boolean(front)]);
  useEffect(() => {
    if (open && front) showBattlefield(front.name, front.side);
  }, [open, front]);
  // The war is over, or the troops are gone from every front: the room shuts.
  useEffect(() => {
    if (open && world && fronts.length === 0) onClose?.();
  }, [open, world, fronts.length, onClose]);

  // How much of the map the panel covers, for fitting a battlefield beside it.
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open || !rootRef.current || isMobile) {
      setWarRoom({ cover: 0 });
      return undefined;
    }
    const measure = () => setWarRoom({ cover: Math.round(rootRef.current?.getBoundingClientRect().width ?? 0) });
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [open, isMobile]);

  // ---- what is on it -------------------------------------------------------------------
  const [cities, setCities] = useState([]);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    readFrontCities(world, game).then((list) => { if (live) setCities(list); }).catch(() => {});
    return () => { live = false; };
    // The cities are the map's: read once an opening, and again when the date moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, game.gameDate, activeGame?.id]);

  const generals = useMemo(() => (record ? generalsOf(record, side) : []), [record, side]);
  const orders = useMemo(() => (record ? chosenOrdersOf(record, side) : []), [record, side]);
  const talk = useMemo(() => (record ? talkOf(record, side) : []), [record, side]);
  const plans = useMemo(
    () => (record ? warRoomPlans({ world, game, record, side, cities }) : []),
    [world, game, record, side, cities],
  );
  const intel = useMemo(
    () => (record ? warRoomIntel({ world, game, record, side, cities, espionage }) : { plans: [], sources: [], lines: [], double: false }),
    [world, game, record, side, cities, espionage],
  );
  useEffect(() => {
    if (open) setWarRoom({ plans, known: intel.plans });
  }, [open, plans, intel]);

  // ---- doing things --------------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const act = useCallback(async (op) => {
    setBusy(true);
    setNotice("");
    try {
      await sendWarRoomOp(op, { turnRunning: isSimulationBusy });
      return true;
    } catch (error) {
      setNotice(String(error?.message || error));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  const name = record?.name ?? "";

  // A way drawn on the map (Map/WarRoomTools.jsx) comes here.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    if (!open || !name) return undefined;
    return onWarRoomWay(async (drawn, way, extra) => {
      if (drawn === "route") {
        if (await act({ op: "route", battlefield: name, troops: selectedRef.current, way })) setWarRoom({ selected: [] });
      } else if (drawn === "diversion") {
        await act({ op: "diversion", battlefield: name, way, troops: selectedRef.current.length || THRUST_TROOPS.spearhead });
      } else if (drawn === "replan" && extra?.replan) {
        await act({ op: "plan", battlefield: name, project: extra.replan, way });
      }
    });
  }, [open, name, act]);

  const orderPicked = async (order) => {
    if (await act({ op: "order", battlefield: name, troops: selected, order })) setWarRoom({ selected: [] });
  };
  const releasePicked = async () => {
    if (await act({ op: "release", battlefield: name, troops: selected })) setWarRoom({ selected: [] });
  };

  // Esc shuts the room, once no tool is in hand (with one in hand it puts the
  // tool down: Map/WarRoomTools.jsx).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape" || getWarRoom().tool !== "pan") return;
      const typing = event.target instanceof HTMLElement && (event.target.tagName === "TEXTAREA" || event.target.tagName === "INPUT");
      if (!typing) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ---- the talk ------------------------------------------------------------------------
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(null);
  const [failure, setFailure] = useState(null);
  const [took, setTook] = useState([]);
  const abortRef = useRef(null);
  const gameIdRef = useRef(activeGame?.id);
  useEffect(() => {
    gameIdRef.current = activeGame?.id;
  }, [activeGame?.id]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  const say = async (text) => {
    const said = String(text ?? "").trim();
    if (!said || sending || !name) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSending({ battlefield: name, text: said });
    setFailure(null);
    setTook([]);
    setInput("");
    try {
      if (isSimulationBusy()) throw new Error("A turn is being resolved: the generals answer once it has landed.");
      const answer = await generateWarRoomReply({ battlefield: name, message: said, signal: controller.signal });
      // The game was changed while they were answering: it is not this game's answer.
      if (controller.signal.aborted || (answer.campaignId && gameIdRef.current && answer.campaignId !== gameIdRef.current)) return;
      await sendWarRoomOp({ op: "talk", battlefield: answer.battlefield, said, lines: answer.lines, orders: answer.orders, names: answer.names }, { turnRunning: isSimulationBusy });
      setTook(answer.orders);
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") return;
      setFailure({ battlefield: name, text: said, reason: String(error?.message || error) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(null);
    }
  };

  // The talk is kept at its end as it grows.
  const talkRef = useRef(null);
  useEffect(() => {
    const box = talkRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [talk.length, sending, failure, took, open, name]);

  const [resizing, setResizing] = useState(false);
  const startResize = useCallback((event) => {
    if (typeof onResize !== "function") return;
    event.preventDefault();
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* optional */ }
    setResizing(true);
    const onMove = (moveEvent) => onResize(window.innerWidth - moveEvent.clientX);
    const onUp = () => {
      setResizing(false);
      onResizeEnd?.();
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, [onResize, onResizeEnd]);

  // On a phone the panel is the whole screen, so the map is looked at by
  // folding the panel down to its tools.
  const [folded, setFolded] = useState(false);
  const foldedNow = isMobile && folded;
  const drawing = tool !== "pan";
  const nameOf = (command) => generals.find((general) => general.command === command)?.name || "";
  const locked = turnRunning || busy;
  const other = record ? record.sides[1 - side] ?? [] : [];
  const mine = record ? record.sides[side] ?? [] : [];
  const ownPlans = plans.filter((plan) => !(plan.kind === "order" && !plan.chosen && plan.ways.length === 0));
  // A movement still to be made has its arrow on the map. One that time has
  // passed over is being carried out, or has been: it is listed apart, and its
  // arrow is off the map unless it is pointed at.
  const planned = ownPlans.filter((plan) => !plan.begun && !plan.done);
  const underWay = ownPlans.filter((plan) => plan.begun || plan.done);
  const planRow = (plan) => {
    const past = plan.begun || plan.done;
    const tone = planTone(plan);
    const redrawing = tool === "replan" && replan === plan.project;
    return (
      <div
        key={plan.id}
        onPointerEnter={() => setWarRoom({ pointed: plan.id })}
        style={{ ...trayStyle(pointed === plan.id), display: "flex", gap: "0.55rem", marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}
      >
        <span aria-hidden="true" style={{ background: past ? PLAN_COLOURS.idle : PLAN_COLOURS[tone], flex: "0 0 auto", height: "0.22rem", marginTop: "0.45rem", width: "0.95rem" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>
            {plan.kind === "diversion" && <>Diversion</>}
            {plan.kind === "route" && <>Route</>}
            {plan.kind === "project" && <span data-no-translate>{plan.name}</span>}
            {plan.kind === "order" && (plan.name ? <span data-no-translate>{plan.name}</span> : <OrderWord order={plan.order} />)}
            {plan.objective && plan.kind !== "project" && <> toward <span data-no-translate>{placeName(plan.objective)}</span></>}
          </div>
          <div style={softText}>
            {plan.kind === "project" && <><OrderWord order={plan.order} />{plan.objective && <> toward <span data-no-translate>{placeName(plan.objective)}</span></>} · </>}
            {plan.kind === "diversion" && <>made to look like {plan.troops} formations</>}
            {plan.kind !== "diversion" && !plan.done && <>{plan.troops} formations</>}
            {plan.done && <>carried out</>}
            {plan.kind === "project" && !plan.done && <> · <ProjectStatus status={plan.status} /></>}
            {plan.kind === "project" && plan.off && <> · held back</>}
            {plan.kind === "project" && plan.edited && <> · redrawn</>}
            {plan.kind === "order" && !plan.chosen && plan.sector && plan.sector !== "all" && <> · <span data-no-translate>{plan.sector}</span></>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.1rem" }}>
            {plan.kind === "project" && plan.own && !plan.done && (
              <>
                <button type="button" disabled={locked} onClick={() => takeTool("replan", { replan: plan.project })} style={linkStyle}>{redrawing ? <>Cancel</> : <>Redraw</>}</button>
                {plan.edited && <button type="button" disabled={locked} onClick={() => act({ op: "plan", battlefield: name, project: plan.project, way: [] })} style={linkStyle}>Suggested way</button>}
                <button type="button" disabled={locked} onClick={() => act({ op: "plan", battlefield: name, project: plan.project, off: !plan.off })} style={linkStyle}>{plan.off ? <>Let it go ahead</> : <>Hold it back</>}</button>
              </>
            )}
            {plan.kind === "project" && plan.own && plan.done && (
              <button type="button" disabled={locked} onClick={() => act({ op: "plan", battlefield: name, project: plan.project, again: true })} style={linkStyle}>Send it again</button>
            )}
            {plan.kind === "diversion" && <button type="button" disabled={locked} onClick={() => act({ op: "unplan", battlefield: name, id: plan.id })} style={linkStyle}>Remove</button>}
            {(plan.kind === "route" || (plan.kind === "order" && plan.chosen)) && plan.picked.length > 0 && (
              <>
                <button type="button" onClick={() => setWarRoom({ selected: plan.picked })} style={linkStyle}>Pick its troops</button>
                <button type="button" disabled={locked} onClick={() => act({ op: "release", battlefield: name, troops: plan.picked })} style={linkStyle}>Call it off</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };
  const panelWidth = `calc(${width || WAR_ROOM_WIDTH} + ${SAFE_RIGHT})`;
  const plate = plateStyle();

  return (
    <>
      {/* The frame of plate round the map: its bar says which battlefield this
          is and what day it is, now that the date widget is out of sight. */}
      {open && !isMobile && record && (
        <>
          <div data-oh-no-motion="" data-oh-war-room-frame="" style={{
            ...plate, position: "fixed", top: 0, left: 0, right: panelWidth, height: `calc(${FRAME_BAR} + ${SAFE_TOP})`, paddingTop: SAFE_TOP, boxSizing: "border-box",
            borderBottom: `2px solid ${STEEL.seam}`, boxShadow: "0 2px 8px rgba(0,0,0,0.5)", zIndex: 9996,
            alignItems: "center", display: "flex", gap: "0.8rem", paddingLeft: "1.5rem", paddingRight: "1.5rem",
          }}>
            <span aria-hidden="true" style={rivetStyle({ left: "0.45rem", bottom: "0.75rem" })} />
            <span aria-hidden="true" style={rivetStyle({ right: "0.45rem", bottom: "0.75rem" })} />
            <div data-no-translate style={{ ...stencilStyle, color: BONE, fontSize: "1rem", letterSpacing: "0.2em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.name}</div>
            <div style={{ ...stencilStyle, color: BONE_SOFT, fontSize: "0.74rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span data-no-translate>{mine.join(", ")}</span> against <span data-no-translate>{other.join(", ")}</span>
              {record.status === "frozen" && <> · ceasefire</>}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ ...stencilStyle, flex: "0 0 auto", fontSize: "0.8rem" }}>{formatGameDateReadable(game.gameDate) || game.gameDate}</div>
          </div>
          <div data-oh-no-motion="" style={{ ...plate, position: "fixed", top: `calc(${FRAME_BAR} + ${SAFE_TOP})`, bottom: 0, left: 0, width: FRAME_STRIP, borderRight: `2px solid ${STEEL.seam}`, zIndex: 9996, pointerEvents: "none" }} />
          <div data-oh-no-motion="" style={{ ...plate, position: "fixed", bottom: 0, left: 0, right: panelWidth, height: FRAME_STRIP, borderTop: `2px solid ${STEEL.seam}`, zIndex: 9996, pointerEvents: "none" }} />
        </>
      )}

      <div
        ref={rootRef}
        data-oh-war-room=""
        style={{
          ...plate,
          position: "fixed",
          top: foldedNow ? "auto" : 0,
          bottom: 0,
          right: 0,
          transform: open ? "translateX(0)" : "translateX(100%)",
          ...(isMobile
            ? { left: 0, paddingTop: foldedNow ? 0 : SAFE_TOP, paddingBottom: SAFE_BOTTOM, paddingLeft: SAFE_LEFT, paddingRight: SAFE_RIGHT, boxSizing: "border-box" }
            : { width: panelWidth, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM, paddingRight: SAFE_RIGHT, boxSizing: "border-box", borderLeft: `3px solid ${STEEL.seam}` }),
          zIndex: isMobile ? 10040 : 9997,
          boxShadow: open ? `inset 1px 0 0 ${STEEL.lip}, -6px 0 26px rgba(0,0,0,0.55)` : "none",
          transition: `transform ${ADVISOR_SLIDE}, box-shadow ${ADVISOR_SLIDE}`,
          display: "flex",
          flexDirection: "column",
          color: BONE,
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        {typeof onResize === "function" && !isMobile && (
          <div
            onPointerDown={startResize}
            title="Drag to resize"
            style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "10px", cursor: "ew-resize", zIndex: 30, touchAction: "none", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <div style={{ width: "3px", height: "42px", borderRadius: "1px", backgroundColor: resizing ? AMBER : "rgba(236,231,218,0.24)" }} />
          </div>
        )}

        {/* The head: what this is, and the way out. A band of red across the top of it. */}
        <div style={{ alignItems: "center", background: "rgba(0,0,0,0.4)", borderBottom: `2px solid ${STEEL.seam}`, borderTop: `4px solid ${RED}`, boxShadow: `0 1px 0 ${STEEL.lip}`, display: "flex", gap: "0.55rem", padding: "0.62rem 1.25rem 0.62rem 1.3rem", position: "relative" }}>
          <span aria-hidden="true" style={rivetStyle({ left: "0.4rem", top: "0.4rem" }, "0.5rem")} />
          <span aria-hidden="true" style={rivetStyle({ left: "0.4rem", bottom: "0.4rem" }, "0.5rem")} />
          <span aria-hidden="true" style={rivetStyle({ right: "0.4rem", top: "0.4rem" }, "0.5rem")} />
          <span aria-hidden="true" style={rivetStyle({ right: "0.4rem", bottom: "0.4rem" }, "0.5rem")} />
          <div style={{ minWidth: 0 }}>
            <div style={{ ...stencilStyle, color: BONE, fontSize: "1.25rem", letterSpacing: "0.24em", lineHeight: 1 }}>War Room</div>
            {record && isMobile && (
              <div style={{ ...softText, fontSize: "0.66rem", marginTop: "0.2rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span data-no-translate>{mine.join(", ")}</span> against <span data-no-translate>{other.join(", ")}</span>
                {record.status === "frozen" && <> · ceasefire</>}
              </div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {isMobile && (
            <button type="button" className="oh-tap" onClick={() => setFolded((value) => !value)} style={keyStyle(false, false)}>
              {foldedNow ? <>Generals</> : <>Map</>}
            </button>
          )}
          <button type="button" className="oh-tap" onClick={() => setWarRoom({ fit: getWarRoom().fit + 1 })} title="Show the whole battlefield" aria-label="Show the whole battlefield" style={{ ...keyStyle(false, false), padding: "0.42rem 0.5rem" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
          <button type="button" className="oh-tap" onClick={onClose} title="Close the war room" aria-label="Close the war room" style={{ ...keyStyle(false, false), padding: "0.42rem 0.55rem" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
        </div>

        {/* A tab a battlefield, when there is more than one. */}
        {fronts.length > 1 && (
          <div role="tablist" aria-label="Battlefields" style={{ background: "rgba(0,0,0,0.26)", borderBottom: `1px solid ${STEEL.seam}`, display: "flex", gap: "0.3rem", overflowX: "auto", padding: "0.45rem 0.7rem" }}>
            {fronts.map((entry) => {
              const on = front && entry.name === front.name;
              return (
                <button
                  key={entry.name}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className="oh-tap"
                  data-no-translate
                  onClick={() => showBattlefield(entry.name, entry.side)}
                  style={{ ...keyStyle(on, false), display: "block", flex: "0 0 auto", maxWidth: "14rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >{entry.name}</button>
              );
            })}
          </div>
        )}

        {!record && (
          <div style={{ ...softText, fontSize: "0.85rem", padding: "1.5rem 1rem", textAlign: "center" }}>Your troops are on no battlefield.</div>
        )}

        {record && (
          <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
            {/* Always in reach: the tools do not scroll away with the lists under them. */}
            <div style={{ borderBottom: `1px solid ${STEEL.seam}`, boxShadow: `0 1px 0 ${STEEL.lip}`, flex: "0 0 auto", padding: "0.65rem 0.8rem 0.6rem" }}>
              {isMobile && fronts.length === 1 && <div data-no-translate style={{ ...stencilStyle, color: BONE, marginBottom: "0.5rem" }}>{record.name}</div>}
              {/* The tools for troops picked out. */}
              <Heading>Troops</Heading>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.32rem", marginTop: "0.45rem" }}>
                <button type="button" className="oh-tap" aria-pressed={tool === "select"} disabled={locked} onClick={() => takeTool("select")} style={keyStyle(tool === "select", locked)}>Select troops</button>
                <button type="button" className="oh-tap" aria-pressed={tool === "route"} disabled={locked || selected.length === 0} onClick={() => takeTool("route")} style={keyStyle(tool === "route", locked || selected.length === 0)}>Draw route</button>
                <button type="button" className="oh-tap" disabled={locked || selected.length === 0} onClick={() => orderPicked("dig in")} style={keyStyle(false, locked || selected.length === 0)}>Dig in</button>
                <button type="button" className="oh-tap" disabled={locked || selected.length === 0} onClick={() => orderPicked("hold")} style={keyStyle(false, locked || selected.length === 0)}>Hold</button>
                <button type="button" className="oh-tap" disabled={locked || selected.length === 0} onClick={() => orderPicked("fall back")} style={keyStyle(false, locked || selected.length === 0)}>Fall back</button>
                <button type="button" className="oh-tap" disabled={locked || selected.length === 0} onClick={releasePicked} title="Give these troops back to their stretch of the line" style={keyStyle(false, locked || selected.length === 0)}>Release</button>
              </div>
              <div style={{ ...softText, marginTop: "0.45rem", minHeight: "1rem" }} role="status">
                {turnRunning && <>A turn is being resolved. Orders are taken once it has landed.</>}
                {!turnRunning && tool === "select" && <>Drag a box round your troops on the map. Hold Shift to add to those picked.{selected.length > 0 && <> {selected.length} picked out.</>}</>}
                {!turnRunning && tool === "route" && <>Draw the way for the {selected.length} picked out. They follow it as the ground and the enemy allow.</>}
                {!turnRunning && tool === "diversion" && <>Draw the movement you want the other side to believe.</>}
                {!turnRunning && tool === "replan" && <>Draw the operation’s way anew.</>}
                {!turnRunning && !drawing && selected.length > 0 && (
                  <>{selected.length} picked out. <button type="button" onClick={() => setWarRoom({ selected: [] })} style={linkStyle}>Clear</button></>
                )}
                {!turnRunning && !drawing && selected.length === 0 && <>Nothing moves here: orders are carried out when time next passes.</>}
                {drawing && !turnRunning && <> <button type="button" onClick={() => takeTool("pan")} style={linkStyle}>Cancel</button></>}
              </div>
              {notice && <div role="alert" data-no-translate style={{ color: "#ffb4a8", fontSize: "0.74rem", marginTop: "0.3rem" }}>{notice}</div>}
            </div>
            <div style={{ borderBottom: foldedNow ? "none" : `2px solid ${STEEL.seam}`, display: foldedNow ? "none" : "block", flex: "0 1 auto", maxHeight: "44%", overflowY: "auto", padding: "0.7rem 0.8rem 0.8rem" }}>

              {/* The key: who commands which troops. */}
              {!foldedNow && (
                <div onPointerLeave={() => setWarRoom({ highlight: -1 })} style={{ marginBottom: "0.8rem" }}>
                  <Heading>Your generals</Heading>
                  {generals.length === 0 && (
                    <div style={{ ...softText, marginTop: "0.4rem" }}>No general has a command here yet. They are given their commands when time next passes.</div>
                  )}
                  {generals.map((general) => {
                    const lit = highlight === general.command;
                    // What he has been told, with how many of his own troops each order is for.
                    const own = new Set(general.troops);
                    const told = orders
                      .map((order) => ({ ...order, mine: order.troops.filter((troop) => own.has(troop)).length }))
                      .filter((order) => order.mine > 0);
                    return (
                      <div
                        key={general.command}
                        data-oh-war-room-general={general.command}
                        onPointerEnter={() => setWarRoom({ highlight: general.command })}
                        onClick={() => setWarRoom({ highlight: lit && isMobile ? -1 : general.command })}
                        style={{ ...trayStyle(lit), display: "flex", gap: "0.55rem", marginTop: "0.3rem", padding: "0.34rem 0.5rem" }}
                      >
                        <Tag number={general.command + 1} lit={lit} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ alignItems: "baseline", display: "flex", gap: "0.4rem" }}>
                            <span data-no-translate style={{ fontSize: "0.84rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{general.name || commandTitle(general.command)}</span>
                            {general.name && <span data-no-translate style={{ ...stencilStyle, color: BONE_FAINT, flex: "0 0 auto", fontSize: "0.68rem" }}>{commandTitle(general.command)}</span>}
                          </div>
                          <div style={{ ...softText, marginTop: "0.1rem" }}>
                            {general.n} formations at {general.pct}% · <DoingWord doing={general.doing} />
                            {general.at && <> near <span data-no-translate>{placeName(general.at)}</span></>}
                            {general.cut > 0 && <> · {general.cut} cut off</>}
                          </div>
                          {told.map((order) => (
                            <div key={order.index} style={{ color: AMBER, fontSize: "0.72rem", marginTop: "0.12rem" }}>
                              Ordered: {order.way ? <>a route drawn for {order.mine}</> : <><OrderWord order={order.order} />{order.objective && <> toward <span data-no-translate>{placeName(order.objective)}</span></>}{order.mine < general.n && <> ({order.mine})</>}</>}
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="oh-tap"
                          onClick={(event) => { event.stopPropagation(); setWarRoom({ selected: general.troops, highlight: general.command }); }}
                          title="Pick out this general's troops"
                          style={{ ...linkStyle, alignSelf: "center", flex: "0 0 auto" }}
                        >Pick</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Every movement meant and not yet made. */}
              {!foldedNow && (
                <div onPointerLeave={() => setWarRoom({ pointed: "" })} style={{ marginTop: "0.85rem" }}>
                  <Heading action={(
                    <button type="button" className="oh-tap" aria-pressed={tool === "diversion"} disabled={locked} onClick={() => takeTool("diversion")} style={keyStyle(tool === "diversion", locked)}>Draw a diversion</button>
                  )}>Planned movements</Heading>
                  {planned.length === 0 && (
                    <div style={{ ...softText, marginTop: "0.4rem" }}>None. A route you draw, an order a general takes, and an operation on your Board that sends troops at a place here all show on the map as arrows.</div>
                  )}
                  {planned.map(planRow)}
                  {ownPlans.some((plan) => plan.kind === "diversion") && (
                    <div style={{ ...softText, color: intel.double ? AMBER : BONE_SOFT, marginTop: "0.35rem" }}>
                      {intel.double
                        ? <>The agent of theirs you turned will send them your diversions in place of your plans.</>
                        : <>You have turned no agent of theirs, so there is nobody to show a diversion to. An agent of theirs you have not caught sends them your real plans.</>}
                    </div>
                  )}

                  {underWay.length > 0 && (
                    <>
                      <Heading style={{ marginTop: "0.8rem" }}>Under way</Heading>
                      <div style={{ ...softText, marginTop: "0.3rem" }}>Time has passed over these, so their arrows are off the map. Point at one to see what is left of it.</div>
                      {underWay.map(planRow)}
                    </>
                  )}

                  <Heading style={{ marginTop: "0.8rem" }}>What is known of theirs</Heading>
                  {intel.plans.length === 0 && (
                    <div style={{ ...softText, marginTop: "0.4rem" }}>
                      {espionage
                        ? <>Nothing. An agent inside one of their countries would send their planned movements here.</>
                        : <>Nothing.</>}
                    </div>
                  )}
                  {intel.plans.map((plan) => (
                    <div
                      key={plan.id}
                      onPointerEnter={() => setWarRoom({ pointed: plan.id })}
                      style={{ ...trayStyle(pointed === plan.id), display: "flex", gap: "0.55rem", marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}
                    >
                      <span aria-hidden="true" style={{ background: PLAN_COLOURS.known, flex: "0 0 auto", height: "0.22rem", marginTop: "0.45rem", width: "0.95rem" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>
                          {plan.name ? <span data-no-translate>{plan.name}</span> : <OrderWord order={plan.order} />}
                          {plan.objective && <> toward <span data-no-translate>{placeName(plan.objective)}</span></>}
                        </div>
                        <div style={softText}>
                          {plan.troops > 0 && <>about {plan.troops} formations</>}
                          {plan.doubted && <> · doubted</>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {intel.sources.length > 0 && (
                    <div style={{ color: BONE_FAINT, fontSize: "0.68rem", marginTop: "0.3rem" }}>
                      From your agent in <span data-no-translate>{[...new Set(intel.sources.map((source) => source.inside))].join(", ")}</span>.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* The talk with the generals: a tray let into the plate. */}
            {!foldedNow && (
              <div style={{ background: "rgba(0,0,0,0.3)", display: "flex", flex: "1 1 0", flexDirection: "column", minHeight: "9rem" }}>
                <div ref={talkRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0.6rem 0.8rem" }}>
                  {talk.length === 0 && !sending && !failure && (
                    <div style={{ ...softText, fontSize: "0.78rem", lineHeight: 1.45, padding: "0.4rem 0.2rem" }}>
                      Speak to your generals. Tell them what you want done and they will say what they think of it; an order they accept is carried out when time next passes.
                    </div>
                  )}
                  {talk.map((line, index) => (
                    <TalkLine key={`${index}:${line.who}`} line={line} name={line.who === "" ? "" : nameOf(line.who)} />
                  ))}
                  {sending && sending.battlefield === name && (
                    <>
                      <TalkLine line={{ who: "", text: sending.text }} name="" />
                      <div role="status" style={{ ...softText, fontSize: "0.74rem", padding: "0.2rem 0.2rem 0.4rem" }}>The generals are conferring…</div>
                    </>
                  )}
                  {!sending && took.length > 0 && took.map((order) => (
                    <div key={order.command} style={{ color: AMBER, fontSize: "0.72rem", padding: "0.1rem 0.2rem" }}>
                      <span data-no-translate>{nameOf(order.command) || commandTitle(order.command)}</span>: <OrderWord order={order.order} />{order.objective && <> toward <span data-no-translate>{placeName(order.objective)}</span></>}. Carried out when time next passes.
                    </div>
                  ))}
                  {failure && failure.battlefield === name && !sending && (
                    <div role="alert" style={{ ...trayStyle(false), margin: "0.3rem 0", padding: "0.6rem 0.7rem" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>The generals could not be reached.</div>
                      {failure.reason && <div data-no-translate style={{ ...softText, marginTop: "0.25rem", overflowWrap: "anywhere" }}>{failure.reason}</div>}
                      <button type="button" className="oh-tap" onClick={() => say(failure.text)} style={{ ...keyStyle(false, false), marginTop: "0.45rem" }}>Try again</button>
                    </div>
                  )}
                </div>
                <form
                  onSubmit={(event) => { event.preventDefault(); say(input); }}
                  style={{ ...plate, alignItems: "flex-end", borderTop: `2px solid ${STEEL.seam}`, boxShadow: `inset 0 1px 0 ${STEEL.lip}`, display: "flex", gap: "0.45rem", padding: "0.55rem 0.7rem" }}
                >
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        say(input);
                      }
                    }}
                    rows={2}
                    maxLength={700}
                    disabled={generals.length === 0}
                    placeholder="Speak to your generals…"
                    aria-label="Speak to your generals"
                    style={{ backgroundColor: "rgba(0,0,0,0.5)", borderTop: `1px solid ${STEEL.sunkLine}`, borderLeft: `1px solid ${STEEL.sunkLine}`, borderRight: `1px solid ${STEEL.lip}`, borderBottom: `1px solid ${STEEL.lip}`, borderRadius: "3px", color: BONE, flex: 1, fontFamily: "inherit", fontSize: "0.85rem", outline: "none", padding: "0.5rem 0.65rem", resize: "none" }}
                  />
                  <button
                    type="submit"
                    className="oh-tap"
                    disabled={Boolean(sending) || !input.trim() || generals.length === 0}
                    title="Send"
                    aria-label="Send"
                    style={{ ...keyStyle(true, Boolean(sending) || !input.trim()), height: "2.6rem", justifyContent: "center", padding: 0, width: "2.6rem" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

// One line of the talk: the commander's on the right, in red; a general's on
// the left, in drab, under his name. What a general says is the model's, in
// the game's language.
const TalkLine = ({ line, name }) => {
  const own = line.who === "";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: own ? "flex-end" : "flex-start", margin: "0.35rem 0" }}>
      {!own && (
        <div style={{ ...stencilStyle, fontSize: "0.7rem", margin: "0 0 0.15rem 0.1rem" }}>
          <span data-no-translate>{name || commandTitle(line.who)}</span>
          {name && <span data-no-translate style={{ color: BONE_FAINT }}> · {commandTitle(line.who)}</span>}
        </div>
      )}
      <div
        data-no-translate
        style={{
          background: own ? RED_DARK : OLIVE,
          borderTop: `1px solid ${own ? RED_BRIGHT : OLIVE_LINE}`,
          borderLeft: `1px solid ${own ? RED : OLIVE_LINE}`,
          borderRight: `1px solid ${STEEL.seam}`,
          borderBottom: `1px solid ${STEEL.seam}`,
          borderRadius: "3px",
          color: BONE,
          fontSize: "0.84rem",
          lineHeight: 1.45,
          maxWidth: "92%",
          overflowWrap: "anywhere",
          padding: "0.5rem 0.7rem",
          whiteSpace: "pre-wrap",
        }}
      >{line.text}</div>
    </div>
  );
};

export { WarRoomPanel };
