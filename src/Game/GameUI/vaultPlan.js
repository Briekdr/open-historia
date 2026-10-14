/*! Open Historia — the vault door's plan © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The numbers of the vault door the app opens on (VaultDoor.jsx draws it):
// how long each part of its opening takes, and the three leaves it is made
// of. Plain data, apart from the drawing, so that it can be checked.

// How long each part takes, in milliseconds.
export const VAULT_TIMING = Object.freeze({
  firstShake: 1400,
  shakeEvery: 3400,
  shake: 520,
  spin: 1500,
  bolts: 380,
  open: 1800,
  fade: 350,
});

// The three leaves, as shapes over the whole screen (percentages of it), and
// where each goes when the door opens. They meet at the middle of the screen;
// the two upper seams reach the sides at 15% of the height.
export const VAULT_LEAVES = Object.freeze([
  Object.freeze({ name: "top", shape: "polygon(0% 0%, 100% 0%, 100% 15%, 50% 50%, 0% 15%)", away: "translate(0%, -66%)" }),
  Object.freeze({ name: "left", shape: "polygon(0% 15%, 50% 50%, 50% 100%, 0% 100%)", away: "translate(-72%, 72%)" }),
  Object.freeze({ name: "right", shape: "polygon(100% 15%, 100% 100%, 50% 100%, 50% 50%)", away: "translate(72%, 72%)" }),
]);
