/**
 * batchUpdateEnrichment.js
 * ------------------------
 * Updates enrichment fields (no photos, no Google data sync) for existing places.
 *
 * Usage:
 *   MODE=cloud node batchUpdateEnrichment.js myCampsites.json
 *
 * This script:
 *  - Reads all enriched place data from a JSON file
 *  - Finds each place in Strapi (by google_place_id or slug)
 *  - Updates only enrichment-related fields
 *  - Handles timeouts, retries, and pacing to prevent hangs
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { fetchJSON, updateByDocumentId, STRAPI_API_URL, authHeaders } from "./syncPlace.js";

dotenv.config();

// ==================================
// Load arguments
// ==================================
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("❌ Please provide a JSON filename (e.g. myCampsites.json)");
  process.exit(1);
}
const filePath = path.resolve(process.cwd(), args[0]);
if (!fs.existsSync(filePath)) {
  console.error(`❌ File not found: ${filePath}`);
  process.exit(1);
}

// ==================================
// Read file (supports multiple JSON blocks)
// ==================================
const fileContent = fs.readFileSync(filePath, "utf-8");
const jsonBlocks = fileContent
  .split(/\n(?=\{)/g)
  .map((b) => b.trim())
  .filter(Boolean);

let placeItems = [];
for (const block of jsonBlocks) {
  try {
    const parsed = JSON.parse(block);
    if (parsed?.places?.length) placeItems.push(...parsed.places);
  } catch (err) {
    console.warn(`⚠️ Skipped invalid JSON block: ${err.message}`);
  }
}

if (!placeItems.length) {
  console.error("❌ No valid places found in file.");
  process.exit(1);
}
console.log(`📦 Loaded ${placeItems.length} place entries for enrichment.\n`);

// ==================================
// Helpers
// ==================================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const normNum = (n) => (typeof n === "number" ? n : Number(n) || 0);
const normStr = (s) => (typeof s === "string" ? s.trim() : "");

// Safe update wrapper (adds timeout + retries)
async function safeUpdate(docId, payload, placeName, slug) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout

  try {
    await updateByDocumentId("places", docId, payload, { signal: controller.signal });
    console.log(`✅ Updated enrichment for "${placeName}" (${slug})`);
    return true;
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    console.warn(`⚠️ Failed to update "${placeName}" — ${msg}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ==================================
// Main Loop
// ==================================
const updated = [];
const failed = [];

for (let i = 0; i < placeItems.length; i++) {
  const item = placeItems[i];
  const googleId = item.google_place_id || item.place_id || null;
  const slug = item.slug || null;

  console.log(`\n🔄 Processing ${i + 1}/${placeItems.length}: ${slug || googleId}`);

  if (!googleId && !slug) {
    console.warn("⚠️ Skipping item (no slug or google_place_id).");
    failed.push({ slug: "unknown", reason: "missing identifier" });
    continue;
  }

  const filterKey = googleId ? "place_id" : "slug";
  const filterVal = encodeURIComponent(googleId || slug);
  const query =
    `${STRAPI_API_URL}/places` +
    `?filters[${filterKey}][$eq]=${filterVal}` +
    `&fields[0]=id&fields[1]=documentId&fields[2]=slug&fields[3]=name`;

  // Retry fetch (3 attempts)
  let placeRes = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      placeRes = await fetchJSON(query);
      if (placeRes?.data?.length) break;
    } catch (err) {
      console.warn(`⚠️ Fetch failed (${attempt}/3): ${err.message}`);
    }
    if (attempt < 3) await delay(2000);
  }

  const place = placeRes?.data?.[0];
  if (!place) {
    console.warn(`⚠️ Place not found for ${filterKey}=${decodeURIComponent(filterVal)}`);
    failed.push({ slug, reason: "place not found" });
    continue;
  }

  const attrs = place.attributes || place;
  const placeDocId = place.documentId ?? attrs.documentId;
  const placeName = place.name ?? attrs.name ?? slug ?? "(unnamed)";

  // Build enrichment payload
  const payload = {};
  for (const key of [
    "description",
    "the_vibe",
    "need_to_know",
    "meta_title",
    "meta_description",
    "facilities_summary",
    "ai_summary",
    "raw_data",
    "experiences_raw",
  ]) {
    if (typeof item[key] === "string") payload[key] = item[key];
  }

  if (item.vibeprofile) {
    const v = item.vibeprofile;
    payload.vibeprofile = {
      comfort_rustic: normNum(v.comfort_rustic),
      peaceful_social: normNum(v.peaceful_social),
      accessible_remote: normNum(v.accessible_remote),
      active_relaxed: normNum(v.active_relaxed),
      family_couple: normNum(v.family_couple),
      wild_managed: normNum(v.wild_managed),
    };
  }

  if (item.seasonalguide) {
    const s = item.seasonalguide;
    payload.seasonalguide = {
      best_season: normStr(s.best_season),
      avoid_season: normStr(s.avoid_season),
      seasonal_notes: normStr(s.seasonal_notes),
      long_stay_friendly:
        s.long_stay_friendly === true || s.long_stay_friendly === "true",
    };
  }

  if (Array.isArray(item.highlight)) payload.highlight = item.highlight;
  if (Array.isArray(item.unexpected)) payload.unexpected = item.unexpected;
  if (Array.isArray(item.tags)) payload.tag = item.tags;
  if (Array.isArray(item.rates)) payload.rates = item.rates;

  if (!Object.keys(payload).length) {
    console.log(`ℹ️ No enrichment data for ${placeName}, skipping.`);
    continue;
  }

  // Log payload size
  const sizeKB = (JSON.stringify(payload).length / 1024).toFixed(1);
  console.log(`📏 Payload size: ${sizeKB} KB`);

  // Send update with retry & delay
  let success = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    success = await safeUpdate(placeDocId, payload, placeName, slug);
    if (success) break;
    console.warn(`🔁 Retrying update (${attempt}/3) for ${placeName}...`);
    await delay(4000);
  }

  if (success) updated.push(slug);
  else failed.push({ slug, reason: "update failed" });

  // Delay before next to avoid Strapi overload
  await delay(3000);
}

// ==================================
// Summary
// ==================================
console.log("\n===============================");
console.log("🏁 Enrichment Update Complete");
console.log("===============================");
console.log(`✅ Updated: ${updated.length}`);
console.log(`❌ Failed: ${failed.length}`);

if (failed.length) {
  console.log("\nFailed items:");
  for (const f of failed) console.log(` - ${f.slug}: ${f.reason}`);
}
