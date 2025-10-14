// enrichDocuments.js — Enrich Strapi Places (local or cloud) using enrichment JSON
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
require("dotenv").config();

// =========================
// CONFIGURATION
// =========================
const MODE = process.env.MODE || "local"; // "local" or "cloud"

const STRAPI_BASE =
  MODE === "cloud"
    ? process.env.CLOUD_STRAPI_URL
    : process.env.LOCAL_STRAPI_URL || "http://127.0.0.1:1337";

const STRAPI_API_URL = `${STRAPI_BASE}/api`;

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

// =========================
// HELPERS
// =========================
const authHeaders = {
  Authorization: `Bearer ${STRAPI_API_TOKEN}`,
  "Content-Type": "application/json",
};

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Authorization: authHeaders.Authorization } });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(json)}`);
  return json;
}

async function updateByDocumentId(endpoint, documentId, payload) {
  const res = await fetch(`${STRAPI_API_URL}/${endpoint}/${documentId}`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ data: payload }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

// =========================
// MERGE HELPERS
// =========================
const normStr = (v) => (v ?? "").toString().trim();
const normNum = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

function mergeRates(existing = [], incoming = []) {
  const map = new Map();
  for (const r of existing) {
    const amount = normNum(r.amount);
    const unit = normStr(r.unit);
    map.set(`${amount}|${unit.toLowerCase()}`, { amount, unit });
  }
  for (const r of incoming) {
    if (!r) continue;
    const amount = normNum(r.amount);
    const unit = normStr(r.unit);
    if (amount === null && !unit) continue;
    map.set(`${amount}|${unit.toLowerCase()}`, { amount, unit });
  }
  return Array.from(map.values());
}

function mergeTags(existing = [], incoming = []) {
  const set = new Map();
  for (const t of existing) {
    const label = normStr(t.label);
    if (label) set.set(label.toLowerCase(), { label });
  }
  for (const t of incoming) {
    if (!t) continue;
    const label = normStr(t.label);
    if (label) set.set(label.toLowerCase(), { label });
  }
  return Array.from(set.values());
}

function mergeRepeatable(existing = [], incoming = [], keyFields = ["title", "description"]) {
  const norm = (obj) => {
    const res = {};
    for (const k of keyFields) {
      if (obj[k] !== undefined) res[k] = normStr(obj[k]);
    }
    return res;
  };
  const incomingNorm = incoming.map(norm).filter((o) => Object.keys(o).length > 0);
  return incomingNorm.length > 0 ? incomingNorm : existing.map(norm);
}

function arraysEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// =========================
// MAIN FUNCTION
// =========================
async function enrichDocuments(enrichmentInput, folder = null) {
  let enrichment;

  // Load enrichment JSON
  if (typeof enrichmentInput === "string") {
    if (!fs.existsSync(enrichmentInput)) {
      throw new Error(`Enrichment file not found: ${enrichmentInput}`);
    }
    enrichment = JSON.parse(fs.readFileSync(enrichmentInput, "utf-8"));
  } else {
    enrichment = enrichmentInput;
  }

  // 🔑 Inject slug from place.json if missing
  if (folder) {
    const placePath = path.join(folder, "place.json");
    if (fs.existsSync(placePath)) {
      const placeData = JSON.parse(fs.readFileSync(placePath, "utf-8"));
      const slug = placeData.slug;
      if (slug) {
        if (!Array.isArray(enrichment.places)) enrichment.places = [{}];
        if (!enrichment.places[0].slug) {
          enrichment.places[0].slug = slug;
          console.log(`🔗 Injected slug from place.json: ${slug}`);
        }
      }
    }
  }

  // =========================
  // 1) Build amenity map
  // =========================
  const amRes = await fetchJSON(
    `${STRAPI_API_URL}/amenities?pagination[pageSize]=200&fields[0]=id&fields[1]=documentId&fields[2]=slug`
  );

  const amenityMap = new Map();
  for (const a of amRes.data) {
    const slug = a.slug ?? a.attributes?.slug;
    const id = a.id ?? a.attributes?.id;
    const documentId = a.documentId ?? a.attributes?.documentId;
    if (slug) amenityMap.set(slug, { id, documentId, slug });
  }

  const placeItems = enrichment.places || [];
  console.log(`🔎 Enriching ${placeItems.length} place(s)`);
  const updated = [];

  // =========================
  // 2) Iterate over each place
  // =========================
  for (const item of placeItems) {
    const slug = item.slug;
    if (!slug) {
      console.warn("⚠️ Skipping place entry with no slug:", item);
      continue;
    }

    const q =
      `${STRAPI_API_URL}/places` +
      `?filters[slug][$eq]=${encodeURIComponent(slug)}` +
      `&populate[amenities][fields][0]=id` +
      `&populate[amenities][fields][1]=documentId` +
      `&populate[amenities][fields][2]=slug` +
      `&populate[rates]=*` +
      `&populate[tag]=*` +
      `&populate[highlight]=*` +
      `&populate[unexpected]=*` +
      `&populate[vibeprofile]=*` +
      `&populate[seasonalguide]=*` +
      `&fields[0]=id&fields[1]=documentId&fields[2]=slug&fields[3]=name&fields[4]=province&fields[5]=region&fields[6]=price_pp`;

    const placeRes = await fetchJSON(q);
    const place = placeRes.data?.[0];
    if (!place) {
      console.warn(`⚠️ Place not found for slug: ${slug}`);
      continue;
    }

    const attrs = place.attributes || place;
    const placeDocId = place.documentId ?? attrs.documentId;
    const placeName = place.name ?? attrs.name ?? slug;

    const currentRates = attrs.rates || [];
    const currentTags = attrs.tag || [];
    const currentHighlights = attrs.highlight || [];
    const currentUnexpected = attrs.unexpected || [];
    const currentAmenities = attrs.amenities || [];
    const currentProvince = attrs.province || null;
    const currentRegion = attrs.region || null;
    const currentPricePP = attrs.price_pp ?? null;

    const currentAmenDocIds = currentAmenities
      .map((a) => a.documentId ?? a.attributes?.documentId)
      .filter(Boolean);
    const currentAmenIds = currentAmenities
      .map((a) => a.id ?? a.attributes?.id)
      .filter((v) => Number.isInteger(v));

    // =========================
    // 3) Resolve amenity slugs
    // =========================
    const requestedSlugs = Array.isArray(item.amenities) ? item.amenities : [];
    const missing = [];
    const targetDocIds = [];
    const targetIds = [];

    for (const s of requestedSlugs) {
      const m = amenityMap.get(s);
      if (!m) missing.push(s);
      else {
        if (m.documentId) targetDocIds.push(m.documentId);
        if (Number.isInteger(m.id)) targetIds.push(m.id);
      }
    }

    if (missing.length)
      console.warn(`⚠️ Missing amenities (not found by slug): ${missing.join(", ")}`);

    const toConnectDocIds = targetDocIds.filter((d) => !currentAmenDocIds.includes(d));
    const toConnectIds = targetIds.filter((n) => !currentAmenIds.includes(n));

    // =========================
    // 4) Build payload
    // =========================
    const payload = {};

    // Simple fields
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

    if (typeof item.featured === "boolean") payload.featured = item.featured;
    if (typeof item.province === "string" && !currentProvince) payload.province = item.province;
    if (typeof item.region === "string" && !currentRegion) payload.region = item.region;
    if (typeof item.price_pp === "number" && item.price_pp !== currentPricePP) {
      payload.price_pp = item.price_pp;
    }

    // ✅ Add VibeProfile Component
    if (item.vibeprofile && typeof item.vibeprofile === "object") {
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

    // ✅ Add SeasonalGuide Component
    if (item.seasonalguide && typeof item.seasonalguide === "object") {
      const s = item.seasonalguide;
      payload.seasonalguide = {
        best_season: normStr(s.best_season),
        avoid_season: normStr(s.avoid_season),
        seasonal_notes: normStr(s.seasonal_notes),
        long_stay_friendly:
          s.long_stay_friendly === true || s.long_stay_friendly === "true" ? true : false,
      };
    }

    // Repeatable components
    if (Array.isArray(item.rates)) {
      const merged = mergeRates(currentRates, item.rates);
      if (!arraysEqual(merged, currentRates)) payload.rates = merged;
    }

    const incomingTags = Array.isArray(item.tags)
      ? item.tags
      : Array.isArray(item.tag)
      ? item.tag
      : [];
    if (incomingTags.length > 0) {
      const merged = mergeTags(currentTags, incomingTags);
      if (!arraysEqual(merged, currentTags)) payload.tag = merged;
    }

    if (Array.isArray(item.highlight)) {
      payload.highlight = mergeRepeatable(currentHighlights, item.highlight, ["title", "description"]);
    }
    if (Array.isArray(item.unexpected)) {
      payload.unexpected = mergeRepeatable(currentUnexpected, item.unexpected, ["title", "description"]);
    }

    if (toConnectDocIds.length > 0) {
      payload.amenities = { connect: toConnectDocIds };
    }

    if (Object.keys(payload).length === 0) {
      console.log(`✔️ ${placeName}: nothing to update`);
      continue;
    }

    console.log(`✨ Updating "${placeName}" (${slug}) with fields: ${Object.keys(payload).join(", ")}`);

    try {
      await updateByDocumentId("places", placeDocId, payload);
      console.log(`✅ Updated place ${placeDocId}`);
      updated.push(slug);
    } catch (e) {
      const msg = String(e.message || e);
      console.warn(`↩︎ Connect failed, trying fallback. Reason: ${msg}`);
      const unionIds = Array.from(new Set([...currentAmenIds, ...toConnectIds]));
      const fallback = { ...payload };
      if (toConnectDocIds.length > 0) fallback.amenities = unionIds;
      const r = await fetch(`${STRAPI_API_URL}/places/${placeDocId}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ data: fallback }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(j));
      console.log(`✅ Updated place ${placeDocId} (fallback)`);
      updated.push(slug);
    }
  }

  console.log("🏁 Enrichment done");
  return updated;
}

// =========================
// EXPORT + TEST RUNNER
// =========================
module.exports = { enrichDocuments };

if (require.main === module) {
  const TEST_FILE = path.join(__dirname, "documentsEnrichment.json");
  enrichDocuments(TEST_FILE).catch((e) => {
    console.error("💥 Script error:", e.message || e);
  });
}
