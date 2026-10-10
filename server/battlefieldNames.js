/*! Open Historia — a renamed country or group, in the battlefields it fights on © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// world.battlefields names the members of its two sides, and who gave each
// standing order, by exact name (src/runtime/fronts/record.js). A country is
// keyed by its name and a rename re-keys it everywhere, so it has to re-key it
// here too, or the renamed country's troops would belong to nobody.
//
// It lives under server/ because the server's own rename (polityRename.js)
// calls it, and server code never imports src/. Imports nothing.
//
// The battlefield's own name is left as it is: it is a label the model was
// given and writes back, and "the Prussia - France front" stays findable after
// Prussia becomes Germany.

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const exact = (left, right) => Boolean(fold(left)) && fold(left) === fold(right);

// `sameName(a, b)` is how the caller tells two names apart; polityRename.js
// passes its own. The list comes back as it was when nothing in it changed. A
// side's members keep their order: a troop names its owner by its place in it.
export const renameInBattlefields = (battlefields, from, to, sameName = exact) => {
  if (!Array.isArray(battlefields) || !fold(from) || !fold(to)) return battlefields;
  let changed = false;
  const renamed = (value) => {
    if (typeof value !== "string" || !sameName(value, from)) return value;
    changed = true;
    return to;
  };
  const rows = battlefields.map((row) => {
    if (!isRecord(row)) return row;
    const next = { ...row };
    if (Array.isArray(row.sides)) {
      next.sides = row.sides.map((members) => {
        if (!Array.isArray(members)) return members;
        const seen = new Set();
        return members.map(renamed).filter((member) => {
          const key = fold(member);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
    }
    if (Array.isArray(row.orders)) {
      next.orders = row.orders.map((order) => (isRecord(order) && order.by ? { ...order, by: renamed(order.by) } : order));
    }
    return next;
  });
  return changed ? rows : battlefields;
};
