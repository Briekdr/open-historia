/*! Open Historia — counting who plays, and in which application: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/visitCount.test.js
//
// "Also add this umami tracker real quick and update the privacy policy." "Also,
// make it track the application so how many people are playing in the main, and
// beta apps individually." The server's side is server/appKind.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VISIT_SCRIPT_URL, VISIT_TAGS, VISIT_WEBSITE_ID, countVisit, visitNeedsKind, visitScriptAttributes, visitTagOf } from "./visitCount.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

// The tag as the owner was given it.
const GIVEN = `<script defer src="https://cloud.umami.is/script.js" data-website-id="452a6cce-d389-4c2d-bc09-e221194c93a2"></script>`;

// A page with nothing on it but a head, that keeps what is added to it.
const page = ({ already = false } = {}) => {
  const added = [];
  return {
    added,
    head: { appendChild: (element) => added.push(element) },
    querySelector: (selector) => (already && selector === "script[data-website-id]" ? {} : null),
    createElement: (name) => ({ name, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, remove() { this.removed = true; } }),
  };
};
const server = (reply) => {
  const asked = [];
  const fetchImpl = async (address) => {
    asked.push(address);
    if (reply instanceof Error) throw reply;
    return { ok: reply !== null, json: async () => reply };
  };
  return { asked, fetchImpl };
};

test("each application is counted under its own tag", () => {
  const desktop = (channel) => visitTagOf({ env: {}, kind: { app: "desktop", channel }, hostname: "localhost" });
  assert.equal(desktop("stable"), "desktop-main");
  assert.equal(desktop("beta"), "desktop-beta");
  assert.equal(desktop("multiplayer"), "desktop-multiplayer");
  assert.equal(desktop(undefined), "desktop-main");
  assert.equal(visitTagOf({ env: {}, kind: { app: "local" }, hostname: "127.0.0.1" }), "self-hosted");
  assert.equal(visitTagOf({ env: { VITE_OH_WEB: true }, hostname: "openhistoria.com" }), "website");
  // No two the same: the count of one is never the count of another.
  assert.equal(new Set(Object.values(VISIT_TAGS)).size, Object.values(VISIT_TAGS).length);
});

test("what is never counted: the Android app, a development run, a page that is not this computer's own", () => {
  // (The Android build is a web build too, and is asked first.)
  assert.equal(visitTagOf({ env: { VITE_OH_NATIVE: true, VITE_OH_WEB: true }, hostname: "localhost" }), "");
  assert.equal(visitTagOf({ env: { DEV: true }, kind: { app: "local" }, hostname: "localhost" }), "");
  // A phone on the local network playing on the desktop app's server, or somebody's own server at its own address.
  assert.equal(visitTagOf({ env: {}, kind: { app: "desktop", channel: "beta" }, hostname: "192.168.1.20" }), "");
  assert.equal(visitTagOf({ env: {}, kind: { app: "local" }, hostname: "historia.example.org" }), "");
  // A server told not to be counted (OH_VISIT_COUNT=0), and one that did not answer.
  assert.equal(visitTagOf({ env: {}, kind: { app: "uncounted" }, hostname: "localhost" }), "");
  assert.equal(visitTagOf({ env: {}, kind: null, hostname: "localhost" }), "");
  // Only a page served by this computer's own server has to ask which application it is.
  assert.equal(visitNeedsKind({}, "localhost"), true);
  assert.equal(visitNeedsKind({}, "192.168.1.20"), false);
  assert.equal(visitNeedsKind({ VITE_OH_WEB: true }, "openhistoria.com"), false);
  assert.equal(visitNeedsKind({ VITE_OH_NATIVE: true, VITE_OH_WEB: true }, "localhost"), false);
  assert.equal(visitNeedsKind({ DEV: true }, "localhost"), false);
});

test("the tag is the one that was given, with the application's name on it", () => {
  assert.ok(GIVEN.includes(`src="${VISIT_SCRIPT_URL}"`) && GIVEN.includes(`data-website-id="${VISIT_WEBSITE_ID}"`));
  assert.deepEqual(visitScriptAttributes("website"), { src: VISIT_SCRIPT_URL, "data-website-id": VISIT_WEBSITE_ID, "data-tag": "website" });
  // In an application the page's query and fragment are not sent.
  assert.deepEqual(visitScriptAttributes("desktop-beta"), {
    src: VISIT_SCRIPT_URL,
    "data-website-id": VISIT_WEBSITE_ID,
    "data-tag": "desktop-beta",
    "data-exclude-search": "true",
    "data-exclude-hash": "true",
  });
});

test("the beta app's page asks its server once and is counted as the beta", async () => {
  const doc = page();
  const { asked, fetchImpl } = server({ app: "desktop", channel: "beta" });
  assert.equal(await countVisit({ env: {}, doc, hostname: "localhost", fetchImpl }), "desktop-beta");
  assert.deepEqual(asked, ["/api/app-kind"]);
  assert.equal(doc.added.length, 1);
  assert.equal(doc.added[0].name, "script");
  assert.equal(doc.added[0].defer, true);
  assert.equal(doc.added[0].attributes["data-tag"], "desktop-beta");
  assert.equal(doc.added[0].attributes.src, VISIT_SCRIPT_URL);
  // A counter that cannot be loaded (offline, blocked) takes itself away again.
  doc.added[0].onerror();
  assert.equal(doc.added[0].removed, true);
});

test("the website asks nobody; and nothing is added where nothing is counted, or twice", async () => {
  const web = page();
  const nobody = server(new Error("the website has no such server"));
  assert.equal(await countVisit({ env: { VITE_OH_WEB: true }, doc: web, hostname: "openhistoria.com", fetchImpl: nobody.fetchImpl }), "website");
  assert.deepEqual([nobody.asked, web.added.length, web.added[0].attributes["data-tag"]], [[], 1, "website"]);

  for (const [env, hostname, reply] of [
    [{ VITE_OH_NATIVE: true, VITE_OH_WEB: true }, "localhost", { app: "desktop", channel: "stable" }],
    [{ DEV: true }, "localhost", { app: "local" }],
    [{}, "192.168.1.20", { app: "desktop", channel: "stable" }],
    [{}, "localhost", { app: "uncounted" }],
    [{}, "localhost", null],
    [{}, "localhost", new Error("no answer")],
  ]) {
    const doc = page();
    assert.equal(await countVisit({ env, doc, hostname, fetchImpl: server(reply).fetchImpl }), "", JSON.stringify([env, hostname]));
    assert.equal(doc.added.length, 0);
  }
  const twice = page({ already: true });
  assert.equal(await countVisit({ env: { VITE_OH_WEB: true }, doc: twice, hostname: "openhistoria.com", fetchImpl: nobody.fetchImpl }), "");
  assert.equal(twice.added.length, 0);
  // No page at all (a test, a worker): nothing, and no error.
  assert.equal(await countVisit({ env: { VITE_OH_WEB: true }, doc: null, hostname: "openhistoria.com" }), "");
});

// Every page of the website: what is written by hand under public/ and site/.
const websitePages = (folder, out = []) => {
  for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) websitePages(relative, out);
    else if (entry.name.endsWith(".html")) out.push(relative);
  }
  return out;
};

test("the website's pages carry the tag as given, once each; the game's own page carries none and counts itself", () => {
  // The pages that are counted at all are the ones with the Google tag: the tag stands beside it.
  const counted = [...websitePages("public"), ...websitePages("site")].filter((file) => read(file).includes("googletagmanager"));
  for (const file of ["site/index.html", "site/404.html", "public/sitemap/index.html", "public/pax-historia-alternative/index.html"]) assert.ok(counted.includes(file), file);
  for (const file of counted) assert.equal(read(file).split(GIVEN).length - 1, 1, file);
  // Pages written by a script are written with it, or the next writing would lose it.
  const wiki = path.join(root, "scripts", "build-wiki.mjs");
  if (fs.existsSync(wiki)) assert.ok(read("scripts/build-wiki.mjs").includes(GIVEN));
  // The game's page is every application's page: a tag written into it could not say which.
  const game = read("index.html");
  assert.equal(game.includes("umami"), false);
  assert.ok(read("src/main.jsx").includes("void countVisit({ env: import.meta.env });"));
  // So the Android app, which loads no analytics, has nothing of it to strip.
  assert.equal(read("vite.config.ts").includes("umami"), false);
});

// (A branch whose website has no privacy policy page yet has nothing to say it in.)
const hasPolicy = fs.existsSync(path.join(root, "public", "privacy", "index.html"));
test("the privacy policy says so", { skip: hasPolicy ? false : "this branch has no privacy policy page" }, () => {
  const policy = read("public/privacy/index.html");
  assert.ok(policy.includes("<strong>Umami</strong>"));
  assert.ok(policy.includes("which application it is"));
  assert.ok(policy.includes("<code>cloud.umami.is</code>"));
  assert.ok(policy.includes("<td>Umami Cloud, in the United States</td>"));
  assert.ok(policy.includes("Data held by Google Analytics, Umami, GitHub, Discord or your AI provider"));
  // The Android app loads neither counter (vite.config.ts dropWebAnalytics), and the policy no longer says it does.
  assert.equal(policy.includes("the desktop app and the Android app when you are online, load <strong>Google Analytics</strong>"), false);
  assert.ok(read("vite.config.ts").includes("const dropWebAnalytics = (isAndroid: boolean) => ({"));
});
