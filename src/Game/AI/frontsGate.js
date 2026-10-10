/*! Open Historia — whether this game fights its land wars on battlefields © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Battlefields and fronts (runtime/fronts/) are a gameplay feature a scenario
// can switch off (server/gameFeatures.js, key "fronts"). Off, nothing of them
// runs: the skip's contract has no frontOrders, its prompt no [Fronts] block,
// no battlefield opens, and land war is the formations and control operations
// it was before.
//
// A feature a build does not list reads as ON everywhere else
// (isFeatureEnabled answers true for a key it has never heard of), which is
// right for a feature that was removed and wrong for one that is not finished.
// So this asks first whether the build lists it at all: until the definition
// is in FEATURE_DEFINITIONS, fronts are off.

import { FEATURE_KEYS, getActiveFeatures, isActiveFeatureEnabled } from "../../runtime/gameFeatures.js";

export const FRONTS_FEATURE = "fronts";

export const frontsOn = () => FEATURE_KEYS.includes(FRONTS_FEATURE) && isActiveFeatureEnabled(FRONTS_FEATURE);

// The scenario's pace for the engine's advances, as a factor: the setting is a
// percentage, 25 to 300, and 100 where it is not set.
export const frontsPace = () => {
  const percent = Number(getActiveFeatures()?.[FRONTS_FEATURE]?.pace);
  if (!Number.isFinite(percent) || percent <= 0) return 1;
  return Math.max(0.25, Math.min(3, percent / 100));
};
