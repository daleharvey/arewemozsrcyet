import fs from "fs/promises"
import * as cheerio from "cheerio";
import {
  CHANGES_FILE,
  DATA_FILE,
  SNAPSHOT_FILE,
  collectStats,
  diffFiles,
  execCmd,
  logChanges,
  readJson,
} from "./common.js";

const MAX_RELEASES_TO_PROCESS = 50;
// moz-src was introduced in 3rd March, 2025 @ https://bugzilla.mozilla.org/show_bug.cgi?id=1945566
// So start from just after then.
//const FIRST_NIGHTLY = "20250305094745";
// However ./mach python seems to have problems running anytime up until around this build.
const FIRST_NIGHTLY = "20250910212829";

async function checkForUpdatesInternal() {
  let cacheJson = [];
  let seenBuilds = {};
  try {
    cacheJson = JSON.parse(await fs.readFile(DATA_FILE, { encoding: "utf-8" }));
    for (let result of cacheJson) {
      seenBuilds[result.build_id] = true;
    }
  } catch(e) { }

  let snapshot = await readJson(SNAPSHOT_FILE, { build_id: null, files: {} });
  let changesJson = await readJson(CHANGES_FILE, {});

  let response = await fetch("https://hg.mozilla.org/mozilla-central/firefoxreleases");
  let $ = cheerio.load(await response.text());

  let data = $.extract({
    releases: [{
      selector: "tr:not(:first-child)",
      value: {
        hgid: {
          selector: "a",
          value: (el) => $(el).attr('href').split("/").pop()
        },
        build_id: {
          selector: "td:nth-child(2)"
        }
      }
    }]
  });

  let buildids = [];

  let pending = data.releases
    .filter(({build_id}) => build_id >= FIRST_NIGHTLY && !seenBuilds?.[build_id])
    .slice(0, MAX_RELEASES_TO_PROCESS)
    .sort((a, b) => a.build_id.localeCompare(b.build_id));

  for (let {hgid, build_id} of pending) {
    console.log("Processing", build_id);

    let hg2git;
    let url = `https://lando.moz.tools/api/hg2git/firefox/${hgid}`;
    try {
      hg2git = await (await fetch(url)).json();
    } catch(e) {
      console.error("error fetching", url, e);
      continue;
    }

    if (!hg2git?.git_hash) {
      console.error("Did not retrieve valid git hash for", url);
      continue;
    }

    let json, files;
    try {
      ({ json, files } = await collectStats(hg2git.git_hash));
      json.build_id = build_id;
      cacheJson.push(json);
    } catch (e) {
      console.error("Error processing ./mach", e);
      continue;
    }

    if (snapshot.build_id && snapshot.build_id < build_id) {
      let changes = diffFiles(snapshot.files, files);
      logChanges(build_id, snapshot.build_id, changes);
      changesJson[build_id] = { previous_build_id: snapshot.build_id, changes };
    }
    if (!snapshot.build_id || snapshot.build_id < build_id) {
      snapshot = { build_id, files };
    }

    buildids.push(build_id);
    seenBuilds[build_id] = true;
    await fs.writeFile(DATA_FILE, JSON.stringify(cacheJson));
    await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot));
    await fs.writeFile(CHANGES_FILE, JSON.stringify(changesJson));
  }
  console.log("Finished processing: ", buildids);

  if (!buildids.length) {
    return;
  }

  let str = buildids.join(", ").replace(/, ([^,]*)$/, " and $1");
  let updatedFiles = `${DATA_FILE} ${SNAPSHOT_FILE} ${CHANGES_FILE}`;
  await execCmd(`git add ${updatedFiles}`);
  await execCmd(`git commit -m 'Automated update for build id${buildids.length > 1 ? "s" : ""} ${str}.' ${updatedFiles}`);
  await execCmd("git push origin main");
}

async function checkForUpdates() {
  try {
    await checkForUpdatesInternal();
  } catch(e) {
    console.error("checkForUpdates failed, will retry in 6 hours:", e.message);
  }
}

// Update once now, and then every 6 hours
checkForUpdates();
setInterval(checkForUpdates, 6 * 3600 * 1000);