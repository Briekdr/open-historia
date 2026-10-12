/*! Open Historia — the map's WebGL is kept, and asked for again: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/webglRecovery.test.js
//
// Seen on a player's Mac (2026-10-12): "WebGL Not Available" over a black map in
// the middle of a campaign, with nothing to press. Neither file loads under bare
// node, so what keeps it from coming back is checked in their source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("the desktop app does not let Chromium take WebGL away for the session", () => {
  const main = read("../electron/main.cjs");
  const ready = main.indexOf("app.whenReady()");
  for (const name of ["ignore-gpu-blocklist", "disable-gpu-process-crash-limit"]) {
    const at = main.indexOf(`app.commandLine.appendSwitch("${name}")`);
    assert.ok(at > 0, `${name} is set`);
    assert.ok(at < ready, `${name} is set before the app is ready, the only time it is read`);
  }
  assert.match(main, /app\.on\("child-process-gone"[\s\S]{0,200}details\?\.type !== "GPU"/, "a stopped graphics process is logged");
});

test("the warning asks again, reloads when WebGL is back, and can be reloaded by hand", () => {
  const page = read("../src/Game/GameUI/main.jsx");
  const effect = page.slice(page.indexOf("if (checkWebGL()) return undefined;"));
  assert.ok(effect.length > 0, "the check no longer happens once only");
  assert.match(effect.slice(0, 600), /setInterval\(/);
  assert.match(effect.slice(0, 600), /window\.location\.reload\(\)/);
  assert.match(effect.slice(0, 600), /clearInterval\(timer\)/, "it stops asking");
  const popup = page.slice(page.indexOf("const WebGLWarningPopup"), page.indexOf("const WebGLWarningPopup") + 3000);
  assert.match(popup, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
});
