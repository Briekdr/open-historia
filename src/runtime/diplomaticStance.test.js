/*! Open Historia — Diplomatic Stance Tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { buildDiplomaticStanceMap, getDiplomaticOwnerColor, DIPLO_COLORS, NEUTRAL_LAND_COLOR } from "./diplomaticStance.js";

test("returns null when player country is not specified", () => {
  assert.equal(buildDiplomaticStanceMap({ playerCountry: "" }), null);
  assert.equal(getDiplomaticOwnerColor("France", null), NEUTRAL_LAND_COLOR);
});

test("identifies the player country correctly and colors it blue", () => {
  const stance = buildDiplomaticStanceMap({ playerCountry: "France" });
  assert.ok(stance);
  assert.equal(getDiplomaticOwnerColor("France", stance), DIPLO_COLORS.player);
  assert.equal(getDiplomaticOwnerColor("FRA", stance), DIPLO_COLORS.player);
});

test("identifies war enemies and colors them red", () => {
  const wars = [
    {
      status: "active",
      sideA: ["France", "United Kingdom"],
      sideB: ["Germany", "Austria"],
    },
  ];
  const stance = buildDiplomaticStanceMap({ playerCountry: "France", wars });
  assert.equal(getDiplomaticOwnerColor("Germany", stance), DIPLO_COLORS.enemy);
  assert.equal(getDiplomaticOwnerColor("DEU", stance), DIPLO_COLORS.enemy);
  assert.equal(getDiplomaticOwnerColor("Austria", stance), DIPLO_COLORS.enemy);
  assert.equal(getDiplomaticOwnerColor("United Kingdom", stance), DIPLO_COLORS.ally);
});

test("identifies allies via mutual defense and alliance agreements (green)", () => {
  const agreements = [
    {
      status: "active",
      category: "alliance",
      parties: ["France", "Belgium"],
    },
    {
      status: "active",
      category: "mutual_defense",
      parties: ["France", "Netherlands"],
    },
  ];
  const stance = buildDiplomaticStanceMap({ playerCountry: "France", agreements });
  assert.equal(getDiplomaticOwnerColor("Belgium", stance), DIPLO_COLORS.ally);
  assert.equal(getDiplomaticOwnerColor("Netherlands", stance), DIPLO_COLORS.ally);
});

test("identifies trade and friendly partners (sky blue)", () => {
  const agreements = [
    {
      status: "active",
      category: "trade_economic",
      parties: ["France", "Spain"],
    },
  ];
  const relations = [
    {
      a: "France",
      b: "Portugal",
      score: 50,
    },
  ];
  const stance = buildDiplomaticStanceMap({ playerCountry: "France", agreements, relations });
  assert.equal(getDiplomaticOwnerColor("Spain", stance), DIPLO_COLORS.friendly);
  assert.equal(getDiplomaticOwnerColor("Portugal", stance), DIPLO_COLORS.friendly);
});

test("colors neutral uninvolved countries with slate grey", () => {
  const stance = buildDiplomaticStanceMap({ playerCountry: "France" });
  assert.equal(getDiplomaticOwnerColor("Brazil", stance), DIPLO_COLORS.neutral);
  assert.equal(getDiplomaticOwnerColor("Japan", stance), DIPLO_COLORS.neutral);
});

test("colors unowned land with neutral land tone", () => {
  const stance = buildDiplomaticStanceMap({ playerCountry: "France" });
  assert.equal(getDiplomaticOwnerColor("", stance), NEUTRAL_LAND_COLOR);
  assert.equal(getDiplomaticOwnerColor(null, stance), NEUTRAL_LAND_COLOR);
});
