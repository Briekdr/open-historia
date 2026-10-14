/*! Open Historia — the AI rates a country's military figures for a scenario's designer: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/militaryRating.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { militaryRatingRequest, readMilitaryRating } from "./militaryRating.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("one request for one country: its name, what is said of it, its era; the figures as the game keeps them", () => {
  const { systemPrompt, userMessage } = militaryRatingRequest({ name: "The Dothraki Sea", note: "Horselords of the grass sea; they will not cross the poison water.", population: 1200000, date: "0298-03-01", era: 0, rules: "A world of swords and dragons." });
  assert.match(userMessage, /^The polity: The Dothraki Sea$/m);
  assert.match(userMessage, /What the scenario says of it: Horselords/);
  assert.match(userMessage, /Its people: 1200000/);
  assert.match(userMessage, /The era its wars are fought in: Before 1500/);
  assert.match(userMessage, /ERA & WORLD RULES:\nA world of swords and dragons\./);
  assert.match(systemPrompt, /0 means it cannot fight there at all: a people that never goes to sea has sea 0/);
  assert.match(systemPrompt, /\{"military":\{"quality":50/);
  // Nothing said, nothing written.
  assert.doesNotMatch(militaryRatingRequest({ name: "Aland" }).userMessage, /Its people|era|RULES/);
  // What comes back is held to what the game keeps.
  assert.deepEqual(readMilitaryRating({ military: { quality: 75, sea: 0, cavalryShare: 0.92, air: -5, bogus: 3 } }), { quality: 75, sea: 0, air: 0, cavalryShare: 0.92 });
  assert.deepEqual(readMilitaryRating({ quality: 40 }), { quality: 40 }, "an answer without its wrapper");
  assert.equal(readMilitaryRating({ military: { note: "no figures" } }), null);
});

test("in the Workshop, the AI fills only the fields the designer left empty", () => {
  const read = (relative) => fs.readFileSync(path.join(here, "../..", relative), "utf8").split("\r\n").join("\n");
  const fields = read("Editor/MilitaryFields.jsx");
  assert.ok(fields.includes("const next = normalizeMilitaryStats({ ...(figures ?? {}), ...(kept ?? {}) });"), "what is set stands");
  assert.ok(fields.includes("{rating ? \"Asking the AI…\" : \"Fill in with AI\"}"));
  assert.ok(read("Editor/PolitiesPanel.jsx").includes("onRate={() => rateMilitaryFigures({"));
  assert.ok(read("Editor/GroupsPanel.jsx").includes("onRate={() => rateMilitaryFigures({"));
});
