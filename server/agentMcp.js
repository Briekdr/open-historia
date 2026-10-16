/*! Open Historia — the game's MCP server for Agents © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The MCP server the player's Agent uses to answer the Agent queue
// (docs/adr/0008-subscription-agents-answer-through-the-game.md). It is served
// by the local server itself, over Streamable HTTP with plain JSON answers, so
// the player installs nothing besides their Agent.
//
// Three tools, and the answer tool is the only way an answer gets in. The read
// tool returns the prompt file's path, never the prompt: a skip prompt is far
// larger than an Agent's limit on one tool result.
import crypto from "crypto";
import { AGENT_MCP_SERVER_NAME } from "./agentFolder.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS = [
  {
    name: "list_requests",
    description:
      "What the Open Historia game is waiting on. status is 'waiting' (answer the listed requests), 'running' (the time skip is still going: call again) or 'idle' (no time skip is pending: stop).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_request",
    description: "One request: the path of its prompt file, the file to write the answer to, and what the answer must look like.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "answer_request",
    description:
      "Hand a request's answer to the game. Pass text, or leave it out after writing the answer to the request's answer file.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, text: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

// Constant-time, so the token cannot be guessed a character at a time.
export const tokenMatches = (header, token) => {
  const given = Buffer.from(String(header || ""));
  const wanted = Buffer.from(`Bearer ${token}`);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
};

const result = (id, value) => ({ jsonrpc: "2.0", id, result: value });
const failure = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const toolText = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const toolRefusal = (message) => ({ content: [{ type: "text", text: message }], isError: true });

const callTool = async (queue, name, args = {}) => {
  if (name === "list_requests") return toolText(await queue.list());
  if (name === "read_request") {
    const request = queue.read(args.id);
    if (!request) return toolRefusal("That request is not waiting for an answer.");
    return toolText({
      id: request.id,
      task: request.task,
      promptFile: request.promptFile,
      answerFile: request.answerFile,
      answer: "Exactly what the prompt file asks for (usually one JSON object), written to answerFile, then answer_request with this id.",
    });
  }
  if (name === "answer_request") {
    const outcome = queue.answer(args.id, args.text);
    return outcome.ok ? toolText({ ok: true }) : toolRefusal(outcome.reason);
  }
  return null;
};

// One JSON-RPC message in, its reply out (null for a notification).
export const handleMcpMessage = async (queue, message) => {
  const { id, method, params } = message || {};
  const isNotification = id === undefined || id === null;
  if (method === "initialize") {
    const asked = params?.protocolVersion;
    return result(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: AGENT_MCP_SERVER_NAME, version: "1" },
      instructions: "Open Historia's Agent queue. Use it only when the player types /skip; see AGENTS.md in this folder.",
    });
  }
  if (isNotification) return null;
  if (method === "ping") return result(id, {});
  if (method === "tools/list") return result(id, { tools: TOOLS });
  if (method === "tools/call") {
    const reply = await callTool(queue, params?.name, params?.arguments || {});
    return reply ? result(id, reply) : failure(id, -32602, `Unknown tool: ${params?.name}`);
  }
  return failure(id, -32601, `Method not found: ${method}`);
};
