/*! Open Historia — the stable app recommends the beta: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/betaRecommendation.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { BETA_BUTTONS, BETA_QUESTION, BETA_RECOMMENDATION, recommendBeta, shouldRecommendBeta } = require("../electron/betaRecommendation.cjs");

// A folder of one file, in memory.
const memoryFs = (initial = null) => {
  let text = initial;
  return {
    readFileSync: () => { if (text === null) throw new Error("ENOENT"); return text; },
    writeFileSync: (_file, value) => { text = value; },
    get text() { return text; },
  };
};
const run = (fs, extra = {}) => {
  const seen = { asked: 0, opened: 0, options: null };
  return recommendBeta({
    fs, recordFile: "beta-recommendation.json", version: "0.0.30", payloadBuild: "",
    ask: async (options) => { seen.asked += 1; seen.options = options; return { response: extra.response ?? 1 }; },
    open: async () => { seen.opened += 1; },
    ...extra,
  }).then((result) => ({ ...result, ...seen }));
};

test("the first start after an install asks, with the download as the highlighted default", async () => {
  const fs = memoryFs();
  const first = await run(fs);
  assert.equal(first.asked, 1);
  assert.equal(first.options.message, BETA_QUESTION);
  assert.equal(first.options.detail, BETA_RECOMMENDATION);
  assert.deepEqual(first.options.buttons, BETA_BUTTONS);
  assert.equal(first.options.buttons[first.options.defaultId], "Download the beta");
  assert.match(BETA_QUESTION, /download the beta version for the best experience\?/);
  assert.match(BETA_RECOMMENDATION, /^We HIGHLY recommend playing the beta\./);
  assert.equal(first.opened, 0, "\"Not now\" opens nothing");
});

test("it does not ask again on the same build, and asks again after every update", async () => {
  const fs = memoryFs();
  await run(fs);
  assert.equal((await run(fs)).asked, 0, "the second start of the same build is quiet");
  assert.equal((await run(fs, { version: "0.0.31" })).asked, 1, "a new installed version asks");
  assert.equal((await run(fs, { version: "0.0.31" })).asked, 0);
  // An update made of chunks changes the files and not the version.
  assert.equal((await run(fs, { version: "0.0.31", payloadBuild: "412" })).asked, 1, "a new update build asks");
  assert.equal((await run(fs, { version: "0.0.31", payloadBuild: "412" })).asked, 0);
});

test("saying yes opens the beta's download", async () => {
  const yes = await run(memoryFs(), { response: 0 });
  assert.equal(yes.opened, 1);
  assert.equal(yes.wanted, true);
});

test("the beta, and a run that is not an install, never ask", async () => {
  assert.equal((await run(memoryFs(), { isBeta: true })).asked, 0);
  assert.equal((await run(memoryFs(), { isPackaged: false })).asked, 0);
  assert.equal(shouldRecommendBeta({ fs: memoryFs(), recordFile: "x", isBeta: true }), false);
});

test("a record that cannot be written means no question, never one on every start", async () => {
  const fs = { readFileSync: () => { throw new Error("ENOENT"); }, writeFileSync: () => { throw new Error("EACCES"); } };
  assert.equal((await run(fs)).asked, 0);
});

test("a damaged record asks once and repairs itself", async () => {
  const fs = memoryFs("{not json");
  assert.equal((await run(fs)).asked, 1);
  assert.equal((await run(fs)).asked, 0);
});

test("the app asks once the game is open, and the update screen says the same with its button highlighted", () => {
  const main = readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  assert.match(main, /require\("\.\/betaRecommendation\.cjs"\)/);
  const boot = main.slice(main.indexOf("const boot = async"));
  assert.ok(boot.indexOf("recommendBeta({") > boot.indexOf("await mainWindow.loadURL("), "after the game's window has loaded, never in front of an update");
  assert.match(boot, /isBeta: IS_BETA/);
  assert.match(boot, /open: \(\) => shell\.openExternal\(BETA_DOWNLOAD_URL\)/);
  const page = readFileSync(new URL("../electron/setup.html", import.meta.url), "utf8");
  assert.ok(page.includes(BETA_QUESTION));
  assert.ok(page.includes("We HIGHLY recommend playing the beta."));
  assert.match(page, /<button type="button" class="recommended" id="getBeta">Download the beta<\/button>/);
});
