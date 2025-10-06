// addPlace.js - enrichment backup saved at the END inside place folder
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const fetch = require("node-fetch");

const readline = require("readline");
const { harvestPlace } = require("./harvestPlace");
const { syncPlace } = require("./syncPlace");
const { enrichDocuments } = require("./enrichDocuments");

// --- CONFIG ---
const STRAPI_URL = "http://127.0.0.1:1337"; 

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
    const editorCmd = process.env.EDITOR || "code"; // default VS Code
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
    const res = await fetch(`${STRAPI_URL}/_health`);
    if (res.ok) return true;
  } catch {}
  return false;
}

async function waitForStrapi(timeoutMs = 300000, intervalMs = 5000) {
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
    "description","province","region","the_vibe","need_to_know","rates","price_pp","tags","amenities",
    "highlight","unexpected","meta_title","meta_description","facilities_summary","ai_summary",
    "raw_data","experiences_raw"
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

async function main() {
  try {
    console.log("➕ Add a new place to Strapi");
    await waitForStrapi();

    const placeId = await prompt("📍 Enter Google Place ID: ");

    console.log("🌍 Harvesting place data from Google...");
    const folder = await harvestPlace(placeId);
    console.log(`📂 Data saved in: ${folder}`);

    // --- Create temp file for enrichment JSON
    const tmpFile = path.join(os.tmpdir(), `enrichment-${Date.now()}.json`);
    fs.writeFileSync(
        tmpFile,
        `{\n  "places": [\n    {\n      "description": "",\n      "the_vibe": "",\n      "need_to_know": "",\n      "rates": [],\n      // ... other fields
          }\n  ]\n}`
      );

    console.log(`\n📝 Opening ${process.env.EDITOR || "code"}... Paste enrichment JSON and save/close.\n`);
    await openEditor(tmpFile);

    // --- Read JSON back
    const content = fs.readFileSync(tmpFile, "utf-8");
    let enrichment;
    try {
      enrichment = JSON.parse(content);
    } catch (err) {
      throw new Error(`Invalid JSON in enrichment file: ${err.message}`);
    }

    // --- Inject slug
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

    // --- Sync harvested data first
    console.log("🔄 Syncing harvested data to Strapi...");
    await syncPlace(folder);

    // --- Run enrichment afterwards
    console.log("✨ Running enrichment...");
    await enrichDocuments(enrichment, folder);

    // --- Final summary
    finalChecklist(enrichment);

    // --- Save enrichment backup INSIDE the place folder (at the end only)
    if (slug) {
      const backupPath = path.join(folder, "enrichment.json");
      fs.writeFileSync(backupPath, JSON.stringify(enrichment, null, 2));
      console.log(`💾 Enrichment backup saved -> ${backupPath}`);
    }
  } catch (err) {
    console.error("💥 Error in addPlace workflow:", err.message);
  }
}

main();
