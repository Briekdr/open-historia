/*! Open Historia — the Agent folder © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The folder the player opens their own Agent in (Claude Code, Codex or
// Antigravity CLI) to answer time skips through `/skip`
// (docs/adr/0008-subscription-agents-answer-through-the-game.md).
//
// It lives in the data folder, so an update does not remove it, and everything
// the game puts in it is written again at every start: the instructions, the
// `/skip` skill, the sub-agent and the MCP settings carrying this run's address
// and token. A game update therefore updates what the Agent is told, and an
// address or token from an earlier run is never left behind. The player's own
// files in the folder are left alone. The prompt files of the Agent queue live
// under `requests/`; whatever an earlier run left there is deleted.
//
// The game never starts the Agent and never reads its credentials. Nothing
// written here tells an Agent to pick requests up by itself: `/skip` answers
// the skip that is running and stops.
import fs from "fs";
import path from "path";

export const AGENT_MCP_SERVER_NAME = "open-historia";
export const AGENT_REQUESTS_DIR = "requests";

const TOOL = (name) => `mcp__${AGENT_MCP_SERVER_NAME}__${name}`;

const AGENTS_MD = `# Open Historia: answering time skips

This folder belongs to the Open Historia game. The player opens their own Agent
here (Claude Code, Codex or Antigravity CLI) and types \`/skip\` to answer the
time skip the game is waiting on. The game writes this file at every start, so
any change to it is lost; put your own notes in a file of your own.

The game is reached through its MCP server, \`${AGENT_MCP_SERVER_NAME}\`, which has four tools:

- \`list_requests\`: what the game is waiting on. Its \`status\` is
  \`waiting\` (with \`requests\`), \`running\` (the skip is still going, nothing to
  answer yet: ask again) or \`idle\` (no time skip is pending).
- \`read_request\`: one request's prompt file, the file to write the answer to,
  what the answer must look like, and the lookup functions it offers.
- \`lookup\`: asks the game one of those lookup functions (a region's
  neighbours, the exact name of a power, a war's ledger) while you answer.
- \`answer_request\`: hands the answer to the game. It is the only way an answer
  reaches the game.

## Rules

- Only answer when the player has typed \`/skip\`. Never watch for requests by
  yourself, never schedule or loop, and never keep going after the skip ends.
- Never edit the game's saves or any file outside this folder. The game checks
  and applies every answer itself.
- An answer is exactly what the request's prompt asks for: usually a single
  JSON object, with no commentary around it.
- If a tool call is refused because of the token or the address, the game has
  restarted since this session began. Tell the player to start the Agent again
  in this folder.

## What \`/skip\` does

1. Call \`list_requests\`. If the status is \`idle\`, tell the player
   "No time skip is pending" and stop.
2. For each request listed, hand it to a fresh sub-agent (in Claude Code, the
   \`skip-answerer\` agent) with just its id. The sub-agent reads the prompt file,
   writes the answer and calls \`answer_request\`. If your Agent has no
   sub-agents, do this yourself, one request at a time.
3. Call \`list_requests\` again. Repeat step 2 while it says \`waiting\`, and keep
   asking while it says \`running\`. A time skip asks its requests one after
   another (the turn review, history and stat sheets are written from the
   jump's result), so more arrive while the skip runs.
4. When it says \`idle\`, the skip is finished. Tell the player in one line and
   stop.
`;

const SKIP_STEPS = `Answer the time skip Open Historia is waiting on. Follow "What \`/skip\` does" in AGENTS.md:

1. Call \`list_requests\`. If its status is \`idle\`, say "No time skip is pending" and stop.
2. For each listed request, start a fresh \`skip-answerer\` sub-agent with only the request id, in the foreground, and wait for it to finish. Do not read the prompt file yourself: it is large, and the sub-agent keeps it out of this session. If you cannot start sub-agents, answer each request yourself as the skip-answerer agent would.
3. Call \`list_requests\` again. Answer whatever is \`waiting\`; while it says \`running\`, ask again.
4. When it says \`idle\`, tell the player the skip is finished, in one line, and stop.

Never answer anything the player did not start with this command, and never keep watching after the skip ends.
`;

const CLAUDE_SKILL = `---
name: skip
description: Answer the time skip the Open Historia game is waiting on. Only when the player types /skip.
disable-model-invocation: true
---

${SKIP_STEPS}`;

const AGENTS_SKILL = `---
name: skip
description: Answer the time skip the Open Historia game is waiting on. Only when the player asks for /skip.
---

${SKIP_STEPS}`;

// No model and no effort: the sub-agent inherits both from the player's own
// session, which is the one place the player chooses them (ADR 0008).
const SKIP_ANSWERER = `---
name: skip-answerer
description: Answers one Open Historia time-skip request, given its id. Used by /skip.
tools: ${TOOL("read_request")}, ${TOOL("lookup")}, ${TOOL("answer_request")}, Read, Write
---

You answer one request from the Open Historia game. You are given its id.

1. Call \`read_request\` with the id. It returns \`promptFile\`, \`answerFile\` and
   what the answer must look like.
2. Read the whole prompt file. It holds the game's instructions and the world as
   it stands. Follow those instructions exactly, as the game's AI would.
   Where it tells you to call a lookup function, and \`read_request\` listed it,
   call the \`lookup\` tool with the id, the function's name and its arguments.
3. Write your answer, and nothing else, to \`answerFile\`. For a JSON answer
   that is the JSON object alone: no code fence, no commentary.
4. Call \`answer_request\` with the id. Leave out \`text\`: the game reads the
   answer file.
5. Reply with one line saying which request you answered. Never repeat the
   prompt or the answer.

Never edit any other file.
`;

const writeIfChanged = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.readFileSync(file, "utf8") === text) return;
  } catch {
    /* not written yet */
  }
  fs.writeFileSync(file, text, "utf8");
};

const tomlString = (value) => JSON.stringify(String(value));

// `url`: where this run's MCP server answers. `token`: this run's token; a
// call without it is refused.
export const writeAgentFolder = (folder, { url, token }) => {
  const authorization = `Bearer ${token}`;
  writeIfChanged(path.join(folder, "AGENTS.md"), AGENTS_MD);
  writeIfChanged(path.join(folder, "CLAUDE.md"), "@AGENTS.md\n");

  // Claude Code
  writeIfChanged(
    path.join(folder, ".mcp.json"),
    `${JSON.stringify({ mcpServers: { [AGENT_MCP_SERVER_NAME]: { type: "http", url, headers: { Authorization: authorization } } } }, null, 2)}\n`,
  );
  writeIfChanged(path.join(folder, ".claude", "skills", "skip", "SKILL.md"), CLAUDE_SKILL);
  writeIfChanged(path.join(folder, ".claude", "agents", "skip-answerer.md"), SKIP_ANSWERER);

  // Codex (and other Agents that read AGENTS.md and .agents/skills)
  writeIfChanged(
    path.join(folder, ".codex", "config.toml"),
    `[mcp_servers.${AGENT_MCP_SERVER_NAME}]\nurl = ${tomlString(url)}\nhttp_headers = { Authorization = ${tomlString(authorization)} }\n`,
  );
  writeIfChanged(path.join(folder, ".agents", "skills", "skip", "SKILL.md"), AGENTS_SKILL);

  // Prompt files of an earlier run: its queue is gone, and so are they.
  const requests = path.join(folder, AGENT_REQUESTS_DIR);
  fs.rmSync(requests, { recursive: true, force: true });
  fs.mkdirSync(requests, { recursive: true });
};
