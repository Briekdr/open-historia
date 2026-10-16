/*! Open Historia — the notice that a chat waits on the player's own Agent © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the player started that now waits on their own Agent
// (docs/adr/0008-subscription-agents-answer-through-the-game.md): an advisor
// message, a diplomatic reply, a Game Master command, an interactive event.
// Nothing happens until they type /answer in their Agent, so the notice stays
// until it is answered, and offers the way out: the Agent folder, the next
// entry of the Fallback list (Use API key), or Cancel. A time skip says the
// same in its own progress row (time.jsx).

import React, { useSyncExternalStore } from "react";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { agentClient, openAgentFolder } from "../AI/agentConnection.js";
import { AGENT_KINDS, agentHasEntryBelow } from "../AI/providerConfig.js";
import { REQUEST_AGENT, requestActivity } from "../AI/requestActivity.js";

const WAITING_TEXTS = {
  advisor: "Your advisor is waiting for your Agent. Type /answer in your Claude Code, Codex or Antigravity CLI.",
  diplomacy: "A reply to your message is waiting for your Agent. Type /answer in your Claude Code, Codex or Antigravity CLI.",
  gameMaster: "Your Game Master command is waiting for your Agent. Type /answer in your Claude Code, Codex or Antigravity CLI.",
  interactive: "Your interactive event is waiting for your Agent. Type /answer in your Claude Code, Codex or Antigravity CLI.",
  skip: "Your time skip's follow-up is waiting for your Agent. Type /answer in your Claude Code, Codex or Antigravity CLI.",
};

const noticeStyle = {
  position: "fixed",
  bottom: "5.5rem",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 9999,
  display: "flex",
  flexDirection: "column",
  gap: "0.45rem",
  maxWidth: "min(34rem, calc(100vw - 2rem))",
  padding: "0.6rem 0.8rem",
  borderRadius: "12px",
  border: "1px solid rgba(251,191,36,0.35)",
  backgroundColor: "rgba(16,21,24,0.96)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  color: "#fef3c7",
  fontFamily: "sans-serif",
  fontSize: "0.76rem",
  lineHeight: 1.45,
  pointerEvents: "auto",
};

export const AGENT_BUTTON_STYLE = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "8px",
  color: "white",
  cursor: "pointer",
  fontSize: "0.72rem",
  padding: "0.26rem 0.7rem",
};

// Read as one string so the store's snapshot stays the same while nothing changes.
const readWaits = () => JSON.stringify(agentClient.waits());

export const AgentWaitingNotice = () => {
  const isMobile = useIsMobile();
  const waits = JSON.parse(useSyncExternalStore((listener) => agentClient.subscribeWaits(listener), readWaits, readWaits));
  // A skip waiting on the Agent says so in its own progress row; its follow-up
  // after the row has gone (the first stat-sheet reading) says so here.
  const skipShownInRow = requestActivity.current()?.state === REQUEST_AGENT;
  const kinds = AGENT_KINDS.filter((kind) => waits[kind] > 0 && !(kind === "skip" && skipShownInRow));
  if (!kinds.length) return null;
  const canPassOn = agentHasEntryBelow();
  return (
    <div role="status" aria-live="polite" style={{ ...noticeStyle, ...(isMobile ? { width: "max-content" } : null) }}>
      {kinds.map((kind) => <span key={kind}>{WAITING_TEXTS[kind]}</span>)}
      <span style={{ color: "rgba(254,243,199,0.7)" }}>Your Agent writes the reply once you do.</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
        <button type="button" className="oh-tap-row" style={AGENT_BUTTON_STYLE} onClick={() => { void openAgentFolder(); }}>Open the Agent folder</button>
        {canPassOn && (
          <button type="button" className="oh-tap-row" style={AGENT_BUTTON_STYLE} onClick={() => agentClient.passOn(kinds)}>Use API key</button>
        )}
        <button type="button" className="oh-tap-row" style={AGENT_BUTTON_STYLE} onClick={() => agentClient.cancel(kinds)}>Cancel</button>
      </div>
    </div>
  );
};
