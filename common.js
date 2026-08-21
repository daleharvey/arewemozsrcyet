import fs from "fs/promises"
import { exec } from 'node:child_process';

export const REPO_PATH = "./firefox/"
export const DATA_FILE = "./data.json";
export const SNAPSHOT_FILE = "./module-snapshot.json";
export const CHANGES_FILE = "./module-changes.json";

export function execCmd(cmd, cwd) {
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

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, { encoding: "utf-8" }));
  } catch(e) {
    return fallback;
  }
}

export async function collectStats(gitHash, { pull = true } = {}) {
  await execCmd(`git reset --hard HEAD`, REPO_PATH);
  if (pull) {
    await execCmd(`git checkout main`, REPO_PATH);
    await execCmd(`git pull`, REPO_PATH);
  }
  await execCmd(`git checkout ${gitHash}`, REPO_PATH);
  let output = await execCmd(
    `./mach python ../scripts/mozbuild_vs_js_modules_actors_stats.py`,
    REPO_PATH
  );
  let json = JSON.parse(output.split("\n")[0]);
  let files = json.files ?? {};
  delete json.files;
  return { json, files };
}

export function diffFiles(before, after) {
  let changes = {};
  for (let variable of new Set([...Object.keys(before), ...Object.keys(after)])) {
    let beforeFiles = new Set(before[variable] ?? []);
    let afterFiles = new Set(after[variable] ?? []);
    let added = [...afterFiles].filter(file => !beforeFiles.has(file));
    let removed = [...beforeFiles].filter(file => !afterFiles.has(file));
    if (added.length || removed.length) {
      changes[variable] = { added, removed };
    }
  }
  return changes;
}

export function logChanges(buildId, previousBuildId, changes) {
  console.log(`Changes between ${previousBuildId} and ${buildId}:`);
  if (!Object.keys(changes).length) {
    console.log("  No files added or removed");
    return;
  }
  for (let [variable, { added, removed }] of Object.entries(changes)) {
    console.log(`  ${variable}: +${added.length} -${removed.length}`);
    for (let file of added) {
      console.log(`    + ${file}`);
    }
    for (let file of removed) {
      console.log(`    - ${file}`);
    }
  }
}
