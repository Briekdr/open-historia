/*! Open Historia — Diplomatic Stance Resolver © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { ownerIdentityKey, toCountryName } from "./ownerNames.js";

export const NEUTRAL_LAND_COLOR = "rgb(88, 98, 110)";

export const DIPLO_COLORS = Object.freeze({
  player: "rgb(37, 99, 235)",      // #2563eb royal blue
  ally: "rgb(34, 197, 94)",        // #22c55e emerald green
  enemy: "rgb(239, 68, 68)",       // #ef4444 red
  friendly: "rgb(56, 189, 248)",   // #38bdf8 sky blue
  hostile: "rgb(220, 38, 38)",     // #dc2626 darker red
  neutral: "rgb(100, 116, 139)",   // #64748b slate grey
});

/**
 * Builds a fast lookup map of diplomatic stances relative to the player country.
 *
 * @param {Object} options
 * @param {string} options.playerCountry
 * @param {Array} [options.wars]
 * @param {Array} [options.agreements]
 * @param {Array} [options.relations]
 * @returns {{ playerKey: string, stanceMap: Map<string, string> } | null}
 */
export function buildDiplomaticStanceMap({ playerCountry = "", wars = [], agreements = [], relations = [] } = {}) {
  const playerCanonical = toCountryName(playerCountry);
  const playerKey = ownerIdentityKey(playerCanonical);
  if (!playerKey) return null;

  const stanceMap = new Map();
  stanceMap.set(playerKey, "player");

  // 1. Wars (active and ceasefire)
  for (const war of wars || []) {
    const status = String(war?.status || "").toLowerCase();
    if (!["active", "ceasefire"].includes(status)) continue;
    const sideA = (Array.isArray(war?.sideA) ? war.sideA : []).map((p) => ownerIdentityKey(toCountryName(p))).filter(Boolean);
    const sideB = (Array.isArray(war?.sideB) ? war.sideB : []).map((p) => ownerIdentityKey(toCountryName(p))).filter(Boolean);
    const playerOnA = sideA.includes(playerKey);
    const playerOnB = sideB.includes(playerKey);
    if (!playerOnA && !playerOnB) continue;

    const enemies = playerOnA ? sideB : sideA;
    const allies = playerOnA ? sideA : sideB;
    for (const e of enemies) {
      if (e && e !== playerKey) stanceMap.set(e, "enemy");
    }
    for (const a of allies) {
      if (a && a !== playerKey && !stanceMap.has(a)) stanceMap.set(a, "ally");
    }
  }

  // 2. Formal Agreements in force
  for (const agreement of agreements || []) {
    const status = String(agreement?.status || "active").toLowerCase();
    if (status !== "active") continue;
    const parties = (Array.isArray(agreement?.parties) ? agreement.parties : []).map((p) => ownerIdentityKey(toCountryName(p))).filter(Boolean);
    if (!parties.includes(playerKey)) continue;

    const cat = String(agreement?.category || agreement?.type || "").toLowerCase();
    const isAlliance = ["alliance", "mutual_defense", "military_cooperation"].includes(cat);
    for (const p of parties) {
      if (!p || p === playerKey) continue;
      if (isAlliance) {
        stanceMap.set(p, "ally");
      } else if (!stanceMap.has(p)) {
        stanceMap.set(p, "friendly");
      }
    }
  }

  // 3. Bilateral Relations
  for (const rel of relations || []) {
    const a = ownerIdentityKey(toCountryName(rel?.a));
    const b = ownerIdentityKey(toCountryName(rel?.b));
    if (a !== playerKey && b !== playerKey) continue;
    const counterpart = a === playerKey ? b : a;
    if (!counterpart || counterpart === playerKey) continue;
    const score = Number(rel?.score ?? 0);
    if (score >= 30 && !stanceMap.has(counterpart)) {
      stanceMap.set(counterpart, "friendly");
    } else if (score <= -50 && !stanceMap.has(counterpart)) {
      stanceMap.set(counterpart, "hostile");
    }
  }

  return { playerKey, stanceMap };
}

/**
 * Returns the CSS color for an owner in diplomatic map mode.
 *
 * @param {string} owner
 * @param {{ playerKey: string, stanceMap: Map<string, string> } | null} stanceData
 * @returns {string}
 */
export function getDiplomaticOwnerColor(owner, stanceData) {
  if (!owner) return NEUTRAL_LAND_COLOR;
  if (!stanceData) return NEUTRAL_LAND_COLOR;

  const key = ownerIdentityKey(toCountryName(owner));
  if (!key) return NEUTRAL_LAND_COLOR;

  const stance = stanceData.stanceMap.get(key) || "neutral";
  return DIPLO_COLORS[stance] || DIPLO_COLORS.neutral;
}
