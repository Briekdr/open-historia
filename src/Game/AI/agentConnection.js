/*! Open Historia — an Agent Connection's calls © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A call that reaches an Agent entry of the Fallback list
// (docs/adr/0008-subscription-agents-answer-through-the-game.md). Nothing goes to
// a provider: the finished prompt goes into the local server's Agent queue and
// the call waits, with no time limit, until the player's own Agent answers it
// through `/skip` or the player cancels. The answer comes back in the shape a
// provider path returns, so the rest of the call (validation, salvage, the
// application receipt, the staged reveal) runs as it does for an API answer.
//
// One time skip is one skip in the queue, opened by its first request and
// finished when the game has stopped simulating (simulationStatus), so the
// Agent's `/skip` knows to stop.
import { buildAnswerFormatBlock } from "./schemaOutline.js";

// How long one wait for the answer is held open before it is asked again.
const ANSWER_WAIT_MS = 25000;

export const AGENT_GONE_MESSAGE = "The game's local server restarted while it waited for your Agent, so this request is no longer in the Agent queue. Run the time skip again.";

const historyText = (history) => (Array.isArray(history) ? history : [])
    .map((turn) => {
        const text = (Array.isArray(turn?.parts) ? turn.parts : []).map((part) => String(part?.text ?? "")).filter(Boolean).join("\n");
        if (!text) return "";
        return turn?.role === "model" || turn?.role === "assistant" ? `## Your earlier answer\n\n${text}` : text;
    })
    .filter(Boolean)
    .join("\n\n");

// What goes in the request's prompt file. The Agent cannot call the task's
// output function, so the function's shape is spelled out as the answer format,
// as Gemini's JSON-text answers are.
export const buildAgentPrompt = (systemPrompt, history, { tool = null } = {}) => {
    const format = tool?.schema
        ? buildAnswerFormatBlock(tool.schema, { first: Object.keys(tool.schema?.properties ?? {})[0] || "" })
        : "";
    return {
        system: String(systemPrompt ?? ""),
        prompt: [historyText(history), format].filter(Boolean).join("\n\n"),
    };
};

const abortReason = (signal) => signal?.reason ?? new DOMException("Aborted", "AbortError");

const newSkipId = () => (globalThis.crypto?.randomUUID?.() ?? `skip-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const createAgentClient = ({ fetch: send = (...args) => globalThis.fetch(...args), pollMs = ANSWER_WAIT_MS } = {}) => {
    let skip = null; // { id, opened: Promise }

    const call = async (method, route, body, signal) => {
        const response = await send(route, {
            method,
            headers: body === undefined ? undefined : { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
        });
        const json = await response.json().catch(() => ({}));
        return { status: response.status, ok: response.ok, json };
    };

    const currentSkip = () => {
        if (!skip) {
            const id = newSkipId();
            skip = { id, opened: call("POST", "/api/agent/skips", { skipId: id }) };
        }
        return skip;
    };

    return {
        // A page that loads afresh: no skip of an earlier page is running.
        async dropStaleSkips() {
            await call("DELETE", "/api/agent/skips").catch(() => {});
        },

        // The game has stopped simulating: the skip is finished, and the
        // Agent's `/skip` stops.
        async finishSkip() {
            const finished = skip;
            skip = null;
            if (!finished) return;
            await finished.opened.catch(() => {});
            await call("DELETE", `/api/agent/skips/${encodeURIComponent(finished.id)}`).catch(() => {});
        },

        // `spender` names the task (requestBudget.js); the Agent sees it with
        // the request. `onAgentWait` says the call is now waiting on the player.
        async call(systemPrompt, history, opts = {}) {
            const { signal, tool, spender, taskKey, onSend, onActivity, onAgentWait, onToolStream, onReceived } = opts;
            if (signal?.aborted) throw abortReason(signal);
            const { system, prompt } = buildAgentPrompt(systemPrompt, history, { tool });
            const open = currentSkip();
            await open.opened;
            const queued = await call("POST", "/api/agent/requests", { skipId: open.id, task: String(spender || taskKey || ""), system, prompt }, signal);
            if (!queued.ok || !queued.json?.id) throw new Error(queued.json?.error || "The Agent queue did not take the request.");
            const id = queued.json.id;
            onSend?.();
            onAgentWait?.();
            const cancel = () => { void call("DELETE", `/api/agent/requests/${encodeURIComponent(id)}`).catch(() => {}); };
            try {
                for (;;) {
                    if (signal?.aborted) throw abortReason(signal);
                    const polled = await call("GET", `/api/agent/requests/${encodeURIComponent(id)}?waitMs=${pollMs}`, undefined, signal);
                    if (polled.status === 404) throw new Error(AGENT_GONE_MESSAGE);
                    const { state, answer } = polled.json ?? {};
                    if (state === "answered") {
                        const rawText = String(answer ?? "");
                        onReceived?.({ answerChars: rawText.length });
                        if (tool?.name && typeof onToolStream === "function") onToolStream({ name: tool.name, json: rawText });
                        return { rawText, toolInput: null };
                    }
                    if (state === "cancelled") throw signal?.aborted ? abortReason(signal) : new DOMException("The request was cancelled in the Agent queue.", "AbortError");
                    // Still waiting on the player: life, not silence.
                    onActivity?.();
                }
            } catch (error) {
                if (signal?.aborted || error?.name === "AbortError") {
                    cancel();
                    throw signal?.aborted ? abortReason(signal) : error;
                }
                throw error;
            }
        },
    };
};

// The one the game uses.
export const agentClient = createAgentClient();

// Where the Agent folder is, and opening it in the system's file manager. The
// game opens a folder; it never starts an Agent.
export const readAgentFolder = async () => {
    const response = await fetch("/api/agent/folder");
    if (!response.ok) throw new Error("The Agent folder is only on the desktop app.");
    return String((await response.json())?.path ?? "");
};

export const openAgentFolder = async () => {
    const response = await fetch("/api/agent/folder/open", { method: "POST" });
    return response.ok;
};
