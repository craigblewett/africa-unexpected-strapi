// syncPlace.js — Push harvested place folder into Strapi (local or cloud) with debug + timeouts
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const FormData = require("form-data");
require("dotenv").config();

// ==========================
// CONFIGURATION
// ==========================
const MODE = process.env.MODE || "local"; // "local" or "cloud"

const STRAPI_BASE =
  MODE === "cloud"
    ? process.env.CLOUD_STRAPI_URL
    : process.env.LOCAL_STRAPI_URL || "http://127.0.0.1:1337";

const STRAPI_API_URL = `${STRAPI_BASE}/api/places`;
const UPLOAD_URL = `${STRAPI_BASE}/api/upload`;

const STRAPI_API_TOKEN =
  MODE === "cloud"
    ? process.env.CLOUD_STRAPI_TOKEN
    : process.env.LOCAL_STRAPI_TOKEN || process.env.STRAPI_API_TOKEN;

if (!STRAPI_API_TOKEN) {
  console.error("❌ Missing STRAPI_API_TOKEN. Please set it in your .env file.");
  process.exit(1);
}

console.log(`🌍 Running in ${MODE.toUpperCase()} mode`);
console.log(`📡 Base URL: ${STRAPI_BASE}`);

// ==========================
// HELPERS
// ==========================
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// --- Upload file helper ---
async function uploadToStrapi(filePath) {
  console.log(`➡️ Preparing upload: ${filePath}`);
  const formData = new FormData();
  formData.append("files", fs.createReadStream(filePath));

  const res = await fetchWithTimeout(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${STRAPI_API_TOKEN}` },
    body: formData,
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Upload response not JSON (status ${res.status})`);
  }

  if (!res.ok) throw new Error(`Upload failed: ${JSON.stringify(json)}`);
  console.log(`✅ Uploaded ${path.basename(filePath)} → ID ${json[0].id}`);
  return json[0].id;
}

// ==========================
// MAIN FUNCTION
// ==========================
async function syncPlace(folderPath) {
  try {
    const placeFile = path.join(folderPath, "place.json");
    if (!fs.existsSync(placeFile)) {
      throw new Error(`place.json not found in folder: ${folderPath}`);
    }

    const raw = fs.readFileSync(placeFile, "utf-8");
    const harvested = JSON.parse(raw);

    // ------------------------
    // 1) Upload photos
    // ------------------------
    const photos = [];
    let coverPhotoId = null;

    for (const [index, p] of (harvested.photos || []).entries()) {
      const filePath = path.join(folderPath, p.file);
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ Missing photo file: ${filePath}`);
        continue;
      }

      console.log(`➡️ Uploading photo ${index + 1}/${harvested.photos.length}: ${p.file}`);
      try {
        const id = await uploadToStrapi(filePath);
        const photoObj = {
          image: id,
          attribution: p.attribution_text || null,
        };
        if (index === 0) coverPhotoId = id;
        photos.push(photoObj);
      } catch (err) {
        console.error(`❌ Failed to upload ${p.file}:`, err.message);
      }
    }

    // ------------------------
    // 2) Reviews + contact
    // ------------------------
    const reviews = (harvested.reviews || []).map((r) => ({
      author_name: r.author_name || null,
      rating: r.rating || null,
      text: r.text || null,
      review_time: r.review_time || null,
      author_photo: null,
    }));

    const contact = Array.isArray(harvested.contact)
      ? harvested.contact
      : harvested.contact
      ? [harvested.contact]
      : [];

    // ------------------------
    // 3) Default VibeProfile + SeasonalGuide
    // ------------------------
    const vibeprofile = {
      comfort_rustic: null,
      peaceful_social: null,
      accessible_remote: null,
      active_relaxed: null,
      family_couple: null,
      wild_managed: null,
    };

    const seasonalguide = {
      best_season: null,
      avoid_season: null,
      seasonal_notes: null,
      long_stay_friendly: false,
    };

    // ------------------------
    // 4) Payload
    // ------------------------
    const payload = {
      data: {
        name: harvested.name,
        slug: harvested.slug,
        place_id: harvested.place_id,
        province: harvested.province || null,
        town: harvested.town || null,
        address: harvested.address || null,
        opening_hours: harvested.opening_hours || null,
        rating: harvested.rating || null,
        total_reviews: harvested.total_reviews || 0,
        latitude: harvested.latitude || null,
        longitude: harvested.longitude || null,
        photos,
        reviews,
        contact,
        vibeprofile,
        seasonalguide,
        publishedAt: new Date().toISOString(),
      },
    };

    if (coverPhotoId) payload.data.cover_photo = coverPhotoId;

    // ------------------------
    // 5) Upsert by slug
    // ------------------------
    console.log("➡️ Checking for existing place in Strapi...");
    const checkRes = await fetchWithTimeout(
      `${STRAPI_API_URL}?filters[slug][$eq]=${harvested.slug}`,
      { headers: { Authorization: `Bearer ${STRAPI_API_TOKEN}` } }
    );

    const checkJson = await checkRes.json();
    const existing = checkJson.data?.[0];

    console.log("➡️ Payload preview:", JSON.stringify(payload, null, 2).slice(0, 600));

    let strapiRes;
    if (existing) {
      const docId = existing.documentId || existing.id;
      console.log(`🔄 Place exists (documentId=${docId}), updating...`);
      strapiRes = await fetchWithTimeout(`${STRAPI_API_URL}/${docId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${STRAPI_API_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });
    } else {
      console.log("➕ Creating new place...");
      strapiRes = await fetchWithTimeout(STRAPI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${STRAPI_API_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });
    }

    let strapiData;
    try {
      strapiData = await strapiRes.json();
    } catch {
      throw new Error(`Strapi response not JSON (status ${strapiRes.status})`);
    }

    if (!strapiRes.ok) {
      throw new Error(`Strapi save failed: ${JSON.stringify(strapiData)}`);
    }

    console.log("✅ Synced to Strapi:", JSON.stringify(strapiData, null, 2).slice(0, 1000));
    return strapiData;
  } catch (err) {
    console.error("❌ Error syncing place:", err);
    throw err;
  }
}

// ==========================
// EXPORT + TEST RUNNER
// ==========================
module.exports = { syncPlace };

if (require.main === module) {
  const PLACE_FOLDER = path.join(__dirname, "Places/swartberg_wilds");
  syncPlace(PLACE_FOLDER).catch((err) => {
    console.error("💥 Sync failed:", err.message || err);
  });
}
