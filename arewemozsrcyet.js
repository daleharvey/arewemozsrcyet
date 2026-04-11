import fs from "fs/promises"
import * as cheerio from "cheerio";
import { exec } from 'node:child_process';

const REPO_PATH = "./firefox/"
const DATA_FILE = "./data.json";
const MAX_RELEASES_TO_PROCESS = 50;
// moz-src was introduced in 3rd March, 2025 @ https://bugzilla.mozilla.org/show_bug.cgi?id=1945566
// So start from just after then.
//const FIRST_NIGHTLY = "20250305094745";
// However ./mach python seems to have problems running anytime up until around this build.
const FIRST_NIGHTLY = "20250910212829";

function execCmd(cmd, cwd) {
  console.log("Executing: ", cmd)
  let options = {maxBuffer: 1024 * 1024 * 50};
  if (cwd) {
    options.cwd = cwd
  }
  return new Promise((resolve, reject) => {
    try {
      exec(cmd, options, (error, stdout, stderr) => {
        if (stderr) {
          console.log(stderr);
        }
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function checkForUpdatesInternal() {
  let cacheJson = [];
  let seenBuilds = {};
  try {
    cacheJson = JSON.parse(await fs.readFile(DATA_FILE, { encoding: "utf-8" }));
    for (let result of cacheJson) {
      seenBuilds[result.build_id] = true;
    }
  } catch(e) { }

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

  let processedReleases = 0;
  let buildids = [];

  for (let {hgid, build_id} of data.releases) {
    if (
      build_id < FIRST_NIGHTLY ||
      seenBuilds?.[build_id]
    ) {
      continue;
    }
    if (++processedReleases > MAX_RELEASES_TO_PROCESS) {
      break;
    }

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

    let json, data;
    try {
      await execCmd(`git reset --hard HEAD`, REPO_PATH);
      await execCmd(`git checkout main`, REPO_PATH);
      await execCmd(`git pull`, REPO_PATH);
      await execCmd(`git checkout ${hg2git.git_hash}`, REPO_PATH);
      data = await execCmd(`./mach python ../scripts/mozbuild_vs_js_modules_actors_stats.py`, REPO_PATH);
      json = JSON.parse(data.split("\n")[0]);
      json.build_id = build_id;
      cacheJson.push(json);
    } catch (e) {
      console.error("Error processing ./mach", data, e);
      continue;
    }
    buildids.push(build_id);
    seenBuilds[build_id] = true;
    await fs.writeFile(DATA_FILE, JSON.stringify(cacheJson));
  }
  console.log("Finished processing: ", buildids);

  if (!buildids.length) {
    return;
  }

  let str = buildids.join(", ").replace(/, ([^,]*)$/, " and $1");
  await execCmd(`git commit -m 'Automated update for build id${buildids.length > 1 ? "s" : ""} ${str}.' ${DATA_FILE}`);
  await execCmd("git push");
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