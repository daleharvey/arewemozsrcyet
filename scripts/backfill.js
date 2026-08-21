// Fills in module-changes.json for builds already in data.json, run from the
// root of the repository and resumable:
//
//   node scripts/backfill.js 20260501

import fs from "fs/promises"
import {
  CHANGES_FILE,
  DATA_FILE,
  SNAPSHOT_FILE,
  collectStats,
  diffFiles,
  logChanges,
  readJson,
} from "../common.js";

const VARIABLES = ["EXTRA_JS_MODULES", "EXTRA_PP_JS_MODULES", "MOZ_SRC_FILES", "ACTORS"];

function sortByBuildId(changesJson) {
  return Object.fromEntries(
    Object.entries(changesJson).sort(([a], [b]) => a.localeCompare(b))
  );
}

function checkCounts(obj, json) {
  for (let variable of VARIABLES) {
    if ((json[variable] ?? 0) !== (obj[variable] ?? 0)) {
      console.warn(
        `  Warning: ${obj.build_id} ${variable} is ${json[variable]},`,
        `data.json says ${obj[variable]}`
      );
    }
  }
}

async function backfill(startBuildId) {
  let data = await readJson(DATA_FILE, []);
  data.sort((a, b) => a.build_id.localeCompare(b.build_id));

  let changesJson = await readJson(CHANGES_FILE, {});

  let first = data.findIndex(
    obj => obj.build_id >= startBuildId && !changesJson[obj.build_id]
  );
  if (first === -1) {
    console.log(`Nothing to backfill since ${startBuildId}`);
    return;
  }
  if (first === 0) {
    throw new Error("Cannot backfill the oldest build, it has nothing to diff against");
  }

  let todo = data.slice(first);
  let previous = data[first - 1];
  console.log(
    `Backfilling ${todo.length} builds from ${todo[0].build_id},`,
    `diffing the first against ${previous.build_id}`
  );

  let { files: previousFiles } = await collectStats(previous.revision);

  let processed = 0;
  for (let obj of todo) {
    console.log(`[${++processed}/${todo.length}] Processing ${obj.build_id}`);

    let json, files;
    try {
      ({ json, files } = await collectStats(obj.revision, { pull: false }));
    } catch (e) {
      console.error(`  Skipping ${obj.build_id}:`, e.message);
      continue;
    }
    checkCounts(obj, json);

    let changes = diffFiles(previousFiles, files);
    logChanges(obj.build_id, previous.build_id, changes);
    changesJson[obj.build_id] = { previous_build_id: previous.build_id, changes };
    previous = obj;
    previousFiles = files;

    await fs.writeFile(CHANGES_FILE, JSON.stringify(sortByBuildId(changesJson)));
  }

  let snapshot = await readJson(SNAPSHOT_FILE, { build_id: null, files: {} });
  if (!snapshot.build_id || snapshot.build_id <= previous.build_id) {
    await fs.writeFile(
      SNAPSHOT_FILE,
      JSON.stringify({ build_id: previous.build_id, files: previousFiles })
    );
  }
  console.log("Finished backfilling to", previous.build_id);
}

let startBuildId = process.argv[2];
if (!startBuildId) {
  console.error("Usage: node scripts/backfill.js <build id to start from>");
  process.exit(1);
}
await backfill(startBuildId);
