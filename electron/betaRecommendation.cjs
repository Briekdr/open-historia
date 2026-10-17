/*! Open Historia — the stable app recommends the beta © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The stable app asks, once for every build it runs, whether the player wants
// the beta: the first time it opens after being installed, and the first time
// it opens after each update. The owner asked for exactly that (2026-10-10):
// "when you first install main and everytime you update it says do you want
// to download the beta version for the best experience? we HIGHLY recommend
// playing the beta".
//
// "Once for every build" is kept in a small file in the app's own data folder,
// holding the build the question was last asked on. A build is the installed
// version together with the update's own build when one is running, because an
// update made of chunks changes the files without changing the version.
//
// Nothing in here touches Electron, so it is tested under bare node
// (server/betaRecommendation.test.js). main.cjs hands in the dialog.

const BETA_QUESTION = "Do you want to download the beta version for the best experience?";
const BETA_RECOMMENDATION = "We HIGHLY recommend playing the beta. It is a separate app: it installs beside this one and keeps its own saves.";
// The first is the default, which the system draws highlighted.
const BETA_BUTTONS = ["Download the beta", "Not now"];

const buildOf = ({ version = "", payloadBuild = "" } = {}) => `${String(version).trim()}|${String(payloadBuild).trim() || "installed"}`;

const readAskedFor = (fs, recordFile) => {
  try {
    return String(JSON.parse(fs.readFileSync(recordFile, "utf8"))?.askedFor ?? "");
  } catch {
    return ""; // never asked, or a file that cannot be read: ask
  }
};

// Whether this start should ask. Only the packaged stable app does: the beta
// has nothing to recommend, and a developer's run is not an install.
const shouldRecommendBeta = ({ fs, recordFile, isBeta = false, isPackaged = true, version = "", payloadBuild = "" } = {}) => {
  if (isBeta || !isPackaged) return false;
  return readAskedFor(fs, recordFile) !== buildOf({ version, payloadBuild });
};

// Asks, remembers that it asked on this build, and opens the download when
// the player says yes. `ask` is Electron's dialog.showMessageBox bound to the
// game's window; `open` opens the beta's download in the player's browser.
// The build is recorded before the question is shown, so a crash or a forced
// quit while it is up does not ask again on the next start.
const recommendBeta = async ({ fs, recordFile, isBeta = false, isPackaged = true, version = "", payloadBuild = "", ask, open, log = () => {} } = {}) => {
  if (!shouldRecommendBeta({ fs, recordFile, isBeta, isPackaged, version, payloadBuild })) return { asked: false };
  const build = buildOf({ version, payloadBuild });
  try {
    fs.writeFileSync(recordFile, JSON.stringify({ askedFor: build, at: new Date().toISOString() }));
  } catch (error) {
    // Asking every start would be worse than not asking: without the record, stay quiet.
    log("warn", "beta.recommendation.notRecorded", String(error?.message || error));
    return { asked: false };
  }
  const answer = await ask({
    type: "question",
    message: BETA_QUESTION,
    detail: BETA_RECOMMENDATION,
    buttons: BETA_BUTTONS,
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  const wanted = Number(answer?.response) === 0;
  log("info", "beta.recommendation", `${build}: ${wanted ? "download" : "not now"}`);
  if (wanted) await open();
  return { asked: true, wanted };
};

module.exports = { BETA_BUTTONS, BETA_QUESTION, BETA_RECOMMENDATION, buildOf, recommendBeta, shouldRecommendBeta };
