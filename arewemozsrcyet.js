import fs from "fs/promises"
import * as cheerio from "cheerio";
import { exec } from 'node:child_process';

const REPO_PATH = "./firefox/"
const DATA_FILE = "./data.json";
const MAX_RELEASES_TO_PROCESS = 1;
const firstGleanNightly = "20201005215809";

function execCmd(cmd) {
  console.log("Executing: ", cmd)
  let options = {maxBuffer: 1024 * 1024 * 50, cwd: REPO_PATH};
  return new Promise((resolve, reject) => {
    exec(cmd, options, (error, stdout, stderr) => {
      if (stderr) {
        console.log(stderr);
      }
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    })
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
          value: (el, key) => {
            let href = $(el).attr('href');
            return href.split("/").pop();
          }
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
    console.log("Processing", build_id);

    if (
      build_id < firstGleanNightly ||
      seenBuilds?.[build_id]
    ) {
      continue;
    }

    if (++processedReleases > MAX_RELEASES_TO_PROCESS) {
      break;
    }

    let hg2git = await (await fetch(`https://lando.moz.tools/api/hg2git/firefox/${hgid}`)).json();

    console.log("Checking out: ", hg2git.git_hash);
    await execCmd(`git checkout ${hg2git.git_hash}`);
    let data = await execCmd(`./mach python ../scripts/mozbuild_vs_js_modules_actors_stats.py`);
    let json = JSON.parse(data);
    json.build_id = build_id;
    buildids.push(build_id);
    seenBuilds[build_id] = true;
    cacheJson.push(json);
    console.log("Saved json: ", json)
  }

  console.log("Finished processing: ", buildids)
  await fs.writeFile(DATA_FILE, JSON.stringify(cacheJson));

  let str = buildids.join(", ").replace(/, ([^,]*)$/, " and $1");
  //await git(`commit -m 'Automated update for build id${buildids.length > 1 ? "s" : ""} ${string}.' ${dataFile}`);
  //await git("push");
}

async function checkForUpdates() {
  try {
    await checkForUpdatesInternal();
  } catch(e) {
    console.error("checkForUpdates failed, will retry in 6 hours:", e.message);
  }
}

checkForUpdates();