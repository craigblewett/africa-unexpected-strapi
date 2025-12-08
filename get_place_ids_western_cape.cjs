require("dotenv").config();
const fs = require("fs");
const axios = require("axios");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

// === CONFIG ===
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("❌ Missing GOOGLE_API_KEY in .env file");
  process.exit(1);
}

const INPUT_FILE = "Campsites Western Cape/western_cape_campsites_all.csv";
const OUTPUT_FILE = "campsites_with_place_ids.csv";
const RATE_DELAY_MS = 300;
const RETRY_LIMIT = 3;

// === FUNCTIONS ===
function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    if (!fs.existsSync(filePath)) return reject(new Error(`File not found: ${filePath}`));
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function getPlaceInfo(name, town = "") {
  const query = `${name}, ${town}, Western Cape, South Africa`.replace(/, ,/g, ",").replace(/, +/g, ",");
  const url = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";
  const params = {
    input: query,
    inputtype: "textquery",
    fields: "place_id,name,formatted_address,types",
    key: GOOGLE_API_KEY
  };

  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      const res = await axios.get(url, { params, timeout: 8000 });
      const data = res.data;
      if (data.candidates && data.candidates.length > 0) {
        const place = data.candidates[0];
        const hasCampType = place.types?.includes("campground") || place.types?.includes("rv_park");
        if (hasCampType) {
          return {
            Google_Place_ID: place.place_id || "",
            Google_Address: place.formatted_address || "",
            Verified_Types: place.types.join(", ")
          };
        }
      }
      return null;
    } catch (err) {
      console.warn(`⚠️ Error on attempt ${attempt} for ${name}: ${err.message}`);
      if (attempt === RETRY_LIMIT) return null;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// === MAIN ===
(async () => {
  console.log("🚀 Starting enrichment...");

  const rows = await readCsv(INPUT_FILE);
  console.log(`Loaded ${rows.length} rows from ${INPUT_FILE}`);

  const results = [];
  let count = 0;

  for (const row of rows) {
    const nameKey = Object.keys(row).find(k => k.toLowerCase() === "name");
    const townKey = Object.keys(row).find(k => k.toLowerCase() === "town_or_area");
    const name = row[nameKey] || "";
    const town = row[townKey] || "";

    if (!name) continue;

    const info = await getPlaceInfo(name, town);
    results.push({
      ...row,
      Google_Place_ID: info?.Google_Place_ID || "",
      Google_Address: info?.Google_Address || "",
      Verified_Types: info?.Verified_Types || ""
    });

    count++;
    if (count % 5 === 0) console.log(`Processed ${count}/${rows.length}...`);
    await new Promise((r) => setTimeout(r, RATE_DELAY_MS));
  }

  const headers = Object.keys(results[0]).map((key) => ({ id: key, title: key }));
  const csvWriter = createObjectCsvWriter({
    path: OUTPUT_FILE,
    header: headers
  });

  await csvWriter.writeRecords(results);
  console.log(`✅ Done! Saved ${results.length} enriched rows to ${OUTPUT_FILE}`);
})();
