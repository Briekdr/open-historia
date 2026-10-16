/*! Open Historia — the Agent queue © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The requests an Agent Connection is waiting on, held by the local server until
// the player's Agent answers them through the game's MCP server
// (docs/adr/0008-subscription-agents-answer-through-the-game.md).
//
// In memory only: a restart drops it, as a reload drops a skip waiting on an
// API. One time skip is open at a time; opening the next one cancels whatever
// the last left waiting, which is how a reloaded page's requests go away.
//
// A request's prompt is a file in the Agent folder, not a tool result: a skip
// prompt is far larger than an Agent's limit on one MCP result. The file is
// deleted as soon as the request is answered or cancelled.
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const NO_SKIP_PENDING = "No time skip is pending.";
export const SKIP_STILL_RUNNING = "The time skip is still running. Call list_requests again.";

const settle = (waiters) => {
  for (const wake of waiters.splice(0)) wake();
};

// Resolves when `wake` is called or `ms` has passed, whichever is first.
const sleepUntilWoken = (waiters, ms) =>
  new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      const at = waiters.indexOf(wake);
      if (at >= 0) waiters.splice(at, 1);
      resolve();
    }, Math.max(0, ms));
    waiters.push(wake);
  });

// `folder`: the Agent folder's requests directory. `waitMs`: how long one
// "what next?" from the Agent may wait before it is told to ask again; an
// Agent gives up on a tool call held open much longer. `log(event, data)`:
// the Diagnostics log.
export const createAgentQueue = ({ folder, waitMs = 30000, log = () => {} }) => {
  const requests = new Map();
  let openSkip = null;
  // Woken whenever anything changes: a request queued, answered or cancelled,
  // a skip opened or finished.
  const waiters = [];

  const removeFiles = (request) => {
    fs.rmSync(request.dir, { recursive: true, force: true });
  };

  const close = (request, state, answer) => {
    if (request.state !== "waiting") return false;
    request.state = state;
    if (answer !== undefined) request.answer = answer;
    removeFiles(request);
    log(`agent.${state}`, { id: request.id, task: request.task, skipId: request.skipId });
    settle(waiters);
    return true;
  };

  const cancelSkip = (skipId) => {
    for (const request of requests.values()) {
      if (request.skipId === skipId) close(request, "cancelled");
    }
  };

  const unread = () => [...requests.values()].filter((request) => request.state === "waiting" && !request.read);

  return {
    openSkip(skipId) {
      const id = String(skipId || crypto.randomUUID());
      if (openSkip && openSkip !== id) cancelSkip(openSkip);
      openSkip = id;
      log("agent.skip-open", { skipId: id });
      settle(waiters);
      return id;
    },

    finishSkip(skipId) {
      const id = String(skipId);
      cancelSkip(id);
      if (openSkip === id) openSkip = null;
      log("agent.skip-finished", { skipId: id });
      settle(waiters);
    },

    // `system` and `prompt` are the finished prompt the game built, written to
    // the request's prompt file as they are.
    ask({ skipId, task, system, prompt }) {
      const id = crypto.randomUUID();
      const dir = path.join(folder, id);
      fs.mkdirSync(dir, { recursive: true });
      const promptFile = path.join(dir, "prompt.md");
      const answerFile = path.join(dir, "answer.md");
      const text = [system ? `# Instructions\n\n${system}` : "", `# Request\n\n${prompt || ""}`].filter(Boolean).join("\n\n");
      fs.writeFileSync(promptFile, `${text}\n`, "utf8");
      const request = { id, skipId: String(skipId || openSkip || ""), task: String(task || ""), dir, promptFile, answerFile, state: "waiting", read: false };
      requests.set(id, request);
      log("agent.queued", { id, task: request.task, skipId: request.skipId });
      settle(waiters);
      return request;
    },

    // The game's wait for one request: what it is now, or once it changes,
    // within `ms`. Null for a request this run never held.
    async poll(id, ms = 0) {
      const request = requests.get(String(id));
      if (!request) return null;
      const deadline = Date.now() + Math.max(0, Number(ms) || 0);
      while (request.state === "waiting" && Date.now() < deadline) {
        await sleepUntilWoken(waiters, deadline - Date.now());
      }
      return request.state === "answered" ? { state: "answered", answer: request.answer } : { state: request.state };
    },

    cancel(id) {
      const request = requests.get(String(id));
      return request ? close(request, "cancelled") : false;
    },

    // The Agent's "what next?". Waiting requests it has not read yet; while a
    // skip is open with nothing to answer, waits for one up to `waitMs` and
    // then says "still running". With no skip open it answers at once: it
    // never waits for a skip the player has not started.
    async list() {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const fresh = unread();
        if (fresh.length) return { status: "waiting", requests: fresh.map(({ id, task }) => ({ id, task })) };
        if (!openSkip) return { status: "idle", message: NO_SKIP_PENDING };
        if (Date.now() >= deadline) return { status: "running", message: SKIP_STILL_RUNNING };
        await sleepUntilWoken(waiters, deadline - Date.now());
      }
    },

    read(id) {
      const request = requests.get(String(id));
      if (!request || request.state !== "waiting") return null;
      if (!request.read) {
        request.read = true;
        log("agent.read", { id: request.id, task: request.task, skipId: request.skipId });
      }
      return request;
    },

    // `text`, or what the Agent left in the request's answer file. False when
    // the request is not waiting (answered, cancelled, or never held).
    answer(id, text) {
      const request = requests.get(String(id));
      if (!request || request.state !== "waiting") return { ok: false, reason: "That request is not waiting for an answer." };
      let answer = typeof text === "string" ? text : null;
      if (answer === null) {
        try {
          answer = fs.readFileSync(request.answerFile, "utf8");
        } catch {
          return { ok: false, reason: "No answer was given: pass text, or write the answer to the request's answer file first." };
        }
      }
      if (!answer.trim()) return { ok: false, reason: "The answer is empty." };
      close(request, "answered", answer);
      return { ok: true };
    },
  };
};
