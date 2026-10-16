/*! Open Historia — what each update brings, as the notice behind the vault door tells it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "because the vault door only appears after updates by default now, behind it
// there should be a notice pupup thing announcing the new update and what it
// adds (for minor updates it can be very bland, for major updates it must be
// beautiful, complex and decorated)"; "it should also be custom themed for
// each major update. make it easy to add a custom detailed update thing (and
// animated at times) so its not a hassel to add in the future"; "not every
// update will be in the war theme, there will be a very complex variety. make
// it so it also supports multiple update banners that you can click next
// arrows to see the others if multiple major things are done at once" (the
// owner, 2026-10-15).
//
// EVERY CHANGE PLAYERS WILL NOTICE SHIPS WITH ITS NOTICE HERE, written by
// whoever makes it, unprompted (AGENTS.md; the full guide, with examples:
// docs/update-notices.md).
//
// HOW TO ADD AN UPDATE'S NOTICE
//
//   1. Put an update at the TOP of NEW_UPDATES below (newest first), with an `id`
//      that is new and never reused. A device is shown each update once
//      (updateNotices.js); one that missed several is shown all it missed.
//   2. Give it one BANNER or several: several are paged with arrows (one for
//      each big thing the update does). A banner is the words of one page.
//   3. A MINOR update's banner: a title and a few `items`. It is shown as a
//      plain card (UpdateNotice.jsx MinorBanner); nothing else is needed.
//   4. A MAJOR update's banner: a title, a `lead`, `sections` of items. With no
//      `theme` it is shown in the decorated default (DefaultBanner), coloured
//      by its `palette`. With a `theme`, by that theme's own component: copy
//      themes/ThemeTemplate.jsx to themes/<Name>.jsx, name it in
//      themes/index.js with its chrome (how the arrows, markers, Skip and the
//      button between its pages look), and build it from the kit
//      (updateKit.jsx). A theme may
//      draw several kinds of page, told apart by the banner's `scene`. A theme
//      is loaded only when one of its banners is shown.
//   5. To look at it while making it, open the game with
//      ?updateNotice=<the update's id> (or ?updateNotice=latest): it is shown
//      at once, door or no door, and not remembered as seen.
//
// The words are the player's: plain, and what the update does for them. They
// go into the interface catalog with every other string (public/lang).
//
//   update   { id, kind: "major" | "minor", date: "YYYY-MM-DD", channel?: "alpha" | "beta", banners: [banner] }
//   banner   { title, subtitle?, lead?, theme?, scene?,
//              palette?: { accent, ink, soft, ground, card, buttonInk },
//              items?: [text],                          (a minor update's lines)
//              sections?: [{ heading, icon, items: [text] }],
//              button? }                                (on the last banner: closes)
// `icon` is one of updateKit.jsx ICONS.

import { PAST_UPDATES } from "./notesPast.js";

// The updates since the notice existed, newest first (new ones at the top); with the past (notesPast.js) they
// make UPDATES, newest first by date.
const NEW_UPDATES = [
  {
    // Beta's PR #884 (Briekdr), and alpha's last two, brought into the lab on 2026-10-15. A minor update
    // ("diplomatic map should be marked a minor update", the owner).
    id: "2026-10-diplomatic-map",
    kind: "minor",
    date: "2026-10-15",
    banners: [
      {
        title: "The Diplomatic Map",
        items: [
          "Switch the map between Political and Diplomatic above your country's flag, or in Settings, Map: every country takes the colour of where it stands with you.",
          "A legend beside the switch says what each colour means.",
          "Settings has a Sound page for the music, its volume and the sound effects.",
          "Dragging the map glides more smoothly, and the map no longer stays stuck on loading when a tile server stalls.",
          "Your AI key can be shown or hidden as you type it.",
          "In a shared game, a guest's institution business no longer takes the host's own threads with it.",
        ],
      },
    ],
  },
  {
    id: "2026-10-wars-and-fronts-2",
    kind: "major",
    date: "2026-10-15",
    banners: [
      {
        theme: "warsAndFronts2",
        scene: "front",
        title: "Wars and Fronts",
        subtitle: "Part Two",
        lead: "Wars are fought by troops who tire, dig in and run short, under skies that turn, against a commander who thinks days ahead.",
        sections: [
          {
            heading: "Troops of flesh and steel",
            icon: "swords",
            items: [
              "Troops tire as they march and fight, and recover at rest.",
              "Armies muster over weeks, along a curve the scenario sets.",
              "Each country fights with its own quality, technology, arms and mix of units.",
              "Ground on a battlefield changes hands only where troops take it.",
            ],
          },
          {
            heading: "Walls and supplies",
            icon: "wall",
            items: [
              "Fortified lines must be broken through, and take time to build.",
              "War resources pay for fortifications, and your economy refills them.",
              "Harsh winters wear down every army caught out in them.",
            ],
          },
          {
            heading: "In the air and at sea",
            icon: "plane",
            items: [
              "Every country at war flies its air arm over its battlefields, to support its troops, strike the enemy's, or stay grounded.",
              "Command your fleets: patrol, blockade, escort or seek battle.",
            ],
          },
          {
            heading: "The War Room",
            icon: "flag",
            items: [
              "Fortify: draw a line to be built and choose how strong.",
              "Deploy: draw where your reinforcements come in.",
              "Fleets: give your ships their stations and orders.",
            ],
          },
        ],
      },
      {
        theme: "warsAndFronts2",
        scene: "weather",
        title: "Seasons and Weather",
        subtitle: "The ground fights back",
        lead: "The world has climates now. Every front lives through its seasons, and the weather decides as much as the generals do.",
        sections: [
          {
            heading: "Climate zones",
            icon: "map",
            items: [
              "Seasons and weather follow climate zones drawn across the world, and clear skies are the commonest of all.",
              "Mud, snow, storms and heat slow, blunt and wear armies down.",
            ],
          },
          {
            heading: "Ice and ground",
            icon: "snow",
            items: [
              "Lakes and seas can freeze hard enough to cross, and thaw under those still on them.",
              "Rough ground slows an advance.",
            ],
          },
        ],
      },
      {
        theme: "warsAndFronts2",
        scene: "commander",
        title: "A Commander Worth Fearing",
        subtitle: "It thinks days ahead",
        lead: "The countries you fight no longer follow a script. They plan.",
        sections: [
          {
            heading: "It looks ahead",
            icon: "chess",
            items: [
              "Like a chess engine, it rehearses a dozen plans days ahead on a copy of the battle and chooses the best.",
              "It weighs ground, towns, capitals, its strength, its supply, and troops nearly cut off.",
            ],
          },
          {
            heading: "Trained to win",
            icon: "star",
            items: [
              "Trained in thousands of fair duels on random battlefields, it beats every simple habit, from always attacking to always digging in.",
              "A deep thrust into its land is answered with a counter-offensive.",
            ],
          },
          {
            heading: "Scripted wars",
            icon: "flag",
            items: [
              "Scenario designers can script a war to be lost: that side is led by a plainer commander, and good play can still turn it.",
            ],
          },
        ],
        button: "To the front",
      },
    ],
  },
  {
    // Released before there was a notice to tell of it: "even though its already been released, make a banner for
    // the music update with large floating musical notes that are interactive and music themed" (the owner).
    id: "2026-10-music",
    kind: "major",
    date: "2026-10-13",
    banners: [
      {
        theme: "music",
        title: "The Music",
        subtitle: "A score for every campaign",
        lead: "Open Historia has a soundtrack now, music by Scott Buckley that follows you from the menu to the battlefield.",
        sections: [
          {
            heading: "From the menu to the front",
            icon: "note",
            items: [
              "The menu plays Passage Of Time and Clear Skies, taking turns each visit.",
              "Opening a game swells into the piece's own dramatic build, timed to land as the map appears.",
              "The War Room and the battlefields play Legionnaire and Vanguard.",
            ],
          },
          {
            heading: "Music for scenarios",
            icon: "book",
            items: [
              "Scenario designers choose tracks for loading, for play, for war and for battle from the community hub's music.",
              "A track you already have is never downloaded twice.",
            ],
          },
          {
            heading: "Yours to control",
            icon: "gear",
            items: [
              "Settings show what is playing and who made it.",
              "Sound effects, the vault door's among them, can be turned off.",
            ],
          },
        ],
        button: "Play on",
      },
    ],
  },
];

// Every update, newest first (an update of the same day keeps its place).
export const UPDATES = Object.freeze([...NEW_UPDATES, ...PAST_UPDATES]
  .map((update, index) => ({ update, index }))
  .sort((a, b) => (a.update.date < b.update.date ? 1 : a.update.date > b.update.date ? -1 : a.index - b.index))
  .map(({ update }) => update));
