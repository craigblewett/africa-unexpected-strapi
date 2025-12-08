// batchAddPlaces.js — Batch add/enrich places from a file of multiple { "places": [...] } JSON blocks
// Usage: node batchAddPlaces.js ./batch/myCampsites.json
//
// Reads a file that contains multiple standalone JSON objects one after another, e.g.:
// { "places": [ {...}, {...} ] }
// { "places": [ {...} ] }
// { "places": [ {...}, {...}, {...} ] }
//
// For each place:
//   1) harvestPlace(google_place_id)
//      - If harvest fails OR no photos were downloaded → SKIP and log reason
//   2) syncPlace(folder)
//   3) enrichDocuments({ places: [place] }, folder)
// Logs success/failure and prints a final summary.

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
require("dotenv").config();

const { harvestPlace } = require("./harvestPlace");
const { syncPlace } = require("./syncPlace");
const { enrichDocuments } = require("./enrichDocuments");

// ==========================
// CONFIGURATION
// ==========================
const MODE = process.env.MODE || "local"; // "local" or "cloud"
const STRAPI_BASE =
  MODE === "cloud"
    ? process.env.CLOUD_STRAPI_URL
    : process.env.LOCAL_STRAPI_URL || "http://127.0.0.1:1337";

const BATCH_DELAY_MS = Number(process.env.BATCH_DELAY_MS || 3000); // delay between places
const LOG_FILE = path.join(process.cwd(), "batch_log.txt");

// ==========================
// UTILITIES
// ==========================
function logLine(line) {
  const stamp = new Date().toISOString();
  const out = `[${stamp}] ${line}\n`;
  fs.appendFileSync(LOG_FILE, out, "utf-8");
  // also echo to console
  console.log(line);
}

async function sleep(ms) {
  if (ms > 0) {
    await new Promise((res) => setTimeout(res, ms));
  }
}

async function checkStrapiUp() {
  try {
    const res = await fetch(`${STRAPI_BASE}/_health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForStrapi(timeoutMs = 180000, intervalMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkStrapiUp()) {
      return;
    }
    console.log("⏳ Waiting for Strapi to be ready...");
    await sleep(intervalMs);
  }
  throw new Error("Strapi did not start within timeout");
}

function hasDownloadedPhotos(folderPath) {
  try {
    const files = fs.readdirSync(folderPath);
    return files.some((f) => /^photo_\d+\.(jpg|jpeg|png)$/i.test(f));
  } catch {
    return false;
  }
}

// Split a file containing multiple top-level JSON objects by brace matching
function splitTopLevelJSONObjects(text) {
  const parts = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    } else {
      if (ch === '"') {
        inString = true;
        if (depth === 0 && start === -1) {
          // still not started a json object
        }
        continue;
      }
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          parts.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return parts;
}

function parsePlacesBlocks(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return [];

  const blocks = splitTopLevelJSONObjects(raw);
  const results = [];

  for (const block of blocks) {
    try {
      const obj = JSON.parse(block);
      const places = Array.isArray(obj.places) ? obj.places : [];
      if (places.length > 0) {
        results.push(...places);
      }
    } catch (e) {
      // skip malformed block but log a warning
      logLine(`⚠️ Skipping malformed JSON block: ${e.message}`);
    }
  }
  return results;
}

// ==========================
// MAIN
// ==========================
async function main() {
  try {
    const fileArg = process.argv[2];
    if (!fileArg) {
      console.error("❌ Usage: node batchAddPlaces.js ./path/to/batch.json");
      process.exit(1);
    }
    const inputFile = path.resolve(process.cwd(), fileArg);
    if (!fs.existsSync(inputFile)) {
      console.error(`❌ File not found: ${inputFile}`);
      process.exit(1);
    }

    console.log(`🌍 Running in ${MODE.toUpperCase()} mode`);
    console.log(`📡 Base URL: ${STRAPI_BASE}`);
    console.log(`📖 Reading: ${inputFile}`);
    console.log(`🕒 Delay between places: ${BATCH_DELAY_MS}ms`);
    console.log("");

    // Ensure Strapi is up
    await waitForStrapi();
    console.log("✅ Strapi is up!\n");

    const allPlaces = parsePlacesBlocks(inputFile);
    const total = allPlaces.length;

    if (total === 0) {
      console.log("ℹ️ No places found in the input file.");
      return;
    }

    console.log(`=== Batch Upload ===`);
    console.log(`Found ${total} place(s)\n`);

    const seenSlugs = new Set();
    const failures = []; // { slug, reason }
    let successCount = 0;

    for (let idx = 0; idx < total; idx++) {
      const place = allPlaces[idx] || {};
      const slug = (place.slug || "").trim();
      const googlePlaceId = (place.google_place_id || "").trim();

      // progress line
      console.log(`Processing ${idx + 1}/${total}: ${slug || "(no-slug)"} ...`);

      // Basic validations
      if (!slug) {
        const reason = "missing slug";
        logLine(`❌ Skipping entry (no slug).`);
        failures.push({ slug: "(unknown)", reason });
        continue;
      }
      if (seenSlugs.has(slug)) {
        logLine(`⚠️ Skipping duplicate slug in batch: ${slug}`);
        continue;
      }
      seenSlugs.add(slug);

      if (!googlePlaceId) {
        const reason = "missing google_place_id";
        logLine(`❌ ${slug}: ${reason}`);
        failures.push({ slug, reason });
        continue;
      }

      // 1) HARVEST
      let folder = null;
      try {
        folder = await harvestPlace(googlePlaceId);
      } catch (e) {
        const reason = `invalid google_place_id or harvest failed (${e.message || e})`;
        logLine(`❌ ${slug}: ${reason}`);
        failures.push({ slug, reason });
        await sleep(BATCH_DELAY_MS);
        continue;
      }

      // Ensure photos exist
      if (!folder || !hasDownloadedPhotos(folder)) {
        const reason = "no photos downloaded during harvest";
        logLine(`❌ ${slug}: ${reason}`);
        failures.push({ slug, reason });
        await sleep(BATCH_DELAY_MS);
        continue;
      }

      // 2) SYNC base (upsert)
      try {
        await syncPlace(folder);
      } catch (e) {
        const reason = `sync failed (${e.message || e})`;
        logLine(`❌ ${slug}: ${reason}`);
        failures.push({ slug, reason });
        await sleep(BATCH_DELAY_MS);
        continue;
      }

      // 3) ENRICH using this single place payload
      try {
        await enrichDocuments({ places: [place] }, folder);
      } catch (e) {
        const reason = `enrich failed (${e.message || e})`;
        logLine(`❌ ${slug}: ${reason}`);
        failures.push({ slug, reason });
        await sleep(BATCH_DELAY_MS);
        continue;
      }

      successCount++;
      logLine(`✅ Completed ${slug}`);
      await sleep(BATCH_DELAY_MS);
    }

    // SUMMARY
    const failCount = failures.length;
    const summary = `🏁 Done! ${total} total (${successCount} success, ${failCount} failed)`;
    console.log("\n" + summary);
    logLine(summary);

    if (failCount > 0) {
      console.log("\n❌ Failures:");
      failures.forEach((f) => {
        console.log(` - ${f.slug}: ${f.reason}`);
        logLine(`FAILED ${f.slug}: ${f.reason}`);
      });
      console.log("\n📄 Full details appended to:", LOG_FILE);
    } else {
      console.log("\n🎉 All places processed successfully!");
      logLine("All places processed successfully.");
    }
  } catch (err) {
    console.error("💥 Batch error:", err.message || err);
    logLine(`💥 Batch error: ${err.message || err}`);
    process.exit(1);
  }
}

main();
