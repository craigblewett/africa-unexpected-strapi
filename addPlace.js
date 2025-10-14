// addPlace.js — One-command workflow for adding and enriching a place in Strapi
// Works with MODE=local or MODE=cloud
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const fetch = require("node-fetch");
require("dotenv").config();

const readline = require("readline");
const { harvestPlace } = require("./harvestPlace");
const { syncPlace } = require("./syncPlace");
const { enrichDocuments } = require("./enrichDocuments");

// ==========================
// CONFIGURATION
// ==========================
const MODE = process.env.MODE || "local"; // use "cloud" for live
const STRAPI_BASE =
  MODE === "cloud"
    ? process.env.CLOUD_STRAPI_URL
    : process.env.LOCAL_STRAPI_URL || "http://127.0.0.1:1337";

console.log(`🌍 Running in ${MODE.toUpperCase()} mode`);
console.log(`📡 Base URL: ${STRAPI_BASE}`);

// ==========================
// UTILITIES
// ==========================
async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

function openEditor(filePath) {
  return new Promise((resolve, reject) => {
    const editorCmd = process.env.EDITOR || "code"; // default to VS Code
    const editorArgs = editorCmd.includes("code") ? ["-w", filePath] : [filePath];
    const child = spawn(editorCmd, editorArgs, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${editorCmd} exited with code ${code}`));
    });
  });
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
      console.log("✅ Strapi is up!");
      return;
    }
    console.log("⏳ Waiting for Strapi to be ready...");
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error("Strapi did not start within timeout");
}

function finalChecklist(enrichment) {
  const item = enrichment.places?.[0] || {};
  const requiredFields = [
    "description",
    "province",
    "region",
    "the_vibe",
    "need_to_know",
    "rates",
    "price_pp",
    "tags",
    "amenities",
    "highlight",
    "unexpected",
    "meta_title",
    "meta_description",
    "facilities_summary",
    "ai_summary",
    "raw_data",
    "experiences_raw",
  ];

  let allGood = true;
  console.log("\n🔍 Final Field Checklist:");
  for (const field of requiredFields) {
    const value = item[field];
    const ok =
      (Array.isArray(value) && value.length > 0) ||
      (!!value && typeof value === "string" && value.trim() !== "") ||
      (typeof value === "number" && !isNaN(value));
    console.log(ok ? `  ✅ ${field}` : `  ❌ ${field}`);
    if (!ok) allGood = false;
  }
  console.log(
    allGood
      ? "\n🎉 ALL GREEN: Place uploaded and enriched successfully!\n"
      : "\n⚠️ Some fields are missing — check enrichment JSON.\n"
  );
}

// ==========================
// MAIN WORKFLOW
// ==========================
async function main() {
  try {
    console.log("➕ Add a new place to Strapi");
    await waitForStrapi();

    const placeId = await prompt("📍 Enter Google Place ID: ");
    if (!placeId) throw new Error("No Google Place ID entered.");

    console.log("🌍 Harvesting place data from Google...");
    const folder = await harvestPlace(placeId);
    console.log(`📂 Data saved in: ${folder}`);

    // --- Create temporary enrichment file
    const tmpFile = path.join(os.tmpdir(), `enrichment-${Date.now()}.json`);
    fs.writeFileSync(
      tmpFile,
      `{\n  "places": [\n    {\n      "description": "",\n      "the_vibe": "",\n      "need_to_know": "",\n      "rates": [],\n      "tags": [],\n      "amenities": [],\n      "highlight": [],\n      "unexpected": []\n    }\n  ]\n}`
    );

    console.log(`\n📝 Opening ${process.env.EDITOR || "code"}... Fill in enrichment JSON and save/close.\n`);
    await openEditor(tmpFile);

    // --- Read JSON back
    const content = fs.readFileSync(tmpFile, "utf-8");
    let enrichment;
    try {
      enrichment = JSON.parse(content);
    } catch (err) {
      throw new Error(`Invalid JSON in enrichment file: ${err.message}`);
    }

    // --- Inject slug from harvested place
    const placeJsonPath = path.join(folder, "place.json");
    let slug = null;
    if (fs.existsSync(placeJsonPath)) {
      const placeData = JSON.parse(fs.readFileSync(placeJsonPath, "utf-8"));
      if (enrichment.places && enrichment.places.length > 0) {
        enrichment.places[0].slug = placeData.slug;
        slug = placeData.slug;
      }
      console.log(`🔗 Injected slug from place.json: ${placeData.slug}`);
    }

    // --- Step 1: Sync harvested data
    console.log("\n🔄 Syncing harvested data to Strapi...");
    await syncPlace(folder);

    // --- Step 2: Enrich
    console.log("✨ Running enrichment...");
    await enrichDocuments(enrichment, folder);

    // --- Step 3: Checklist summary
    finalChecklist(enrichment);

    // --- Step 4: Save enrichment backup
    if (slug) {
      const backupPath = path.join(folder, "enrichment.json");
      fs.writeFileSync(backupPath, JSON.stringify(enrichment, null, 2));
      console.log(`💾 Enrichment backup saved → ${backupPath}`);
    }

    console.log("\n✅ Done! Place successfully added and enriched.");
  } catch (err) {
    console.error("💥 Error in addPlace workflow:", err.message);
  }
}

main();
