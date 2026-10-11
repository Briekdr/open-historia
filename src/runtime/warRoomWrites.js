/*! Open Historia — the war room's writes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
//
// Everything the war room (GameUI/warRoom.jsx) changes goes through here as an
// op (runtime/fronts/warRoomOps.js): an order for troops picked out, a route
// drawn for them, what was said to the generals and what they took from it, a
// diversion, a Board operation's arrow redrawn.
//
// Through the write queue, on the world as it stands when the write's turn
// comes, so it cannot put back a world another writer has changed since. A
// turn that is running is working on the world it began with and will write
// over anything written under it: nothing is written until it has landed, and
// the caller is told so.
//
// In a shared game the world is the host's: the page asks (request
// "warroom"), the host checks the troops are the asker's and writes the same
// op, and the next view shows it. A refusal is thrown with the host's reason.
//
// Runs under bare node: the world store and the ops both do.

import { inSharedGame, requestFromHost } from "../multiplayer/client/sharedGameBridge.js";
import { applyWarRoomOp, cleanWarRoomOp } from "./fronts/warRoomOps.js";
import { mutateWorldState, readGameData } from "./gameState.js";

export const TURN_RUNNING_REFUSAL = "A turn is being resolved: the generals take orders once it has landed.";

// Applies one op for the player. Resolves with nothing; throws with a reason a
// person can read when it was refused. `turnRunning` says whether a turn is
// being resolved on this page (the caller has the flag: AI/simulationStatus.js).
export const sendWarRoomOp = async (op, { turnRunning = () => false } = {}) => {
  const sent = cleanWarRoomOp(op);
  if (!sent) throw new Error("Nothing was asked.");
  if (inSharedGame()) {
    const answer = await requestFromHost("warroom", { op: sent });
    if (!answer.ok) throw new Error(answer.error || "The host did not take that.");
    return;
  }
  if (turnRunning()) throw new Error(TURN_RUNNING_REFUSAL);
  const game = await readGameData();
  let refusal = "";
  await mutateWorldState((world) => {
    const result = applyWarRoomOp(world?.battlefields, sent, { player: game?.country, date: game?.gameDate || game?.startDate, transports: world?.transports });
    if (result.error) {
      refusal = result.error;
      return null;
    }
    // (An op for a transporter changes the world's transporters, and no battlefield.)
    return { ...world, battlefields: result.battlefields, ...(result.transports ? { transports: result.transports } : null) };
  });
  if (refusal) throw new Error(refusal);
};
