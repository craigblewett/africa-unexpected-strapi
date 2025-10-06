// harvestPlace.js
// Node 18+ only (uses built-in fetch). No external deps required.

const fs = require("fs");
const path = require("path");
require('dotenv').config();


// =======================
// CONFIG
// =======================
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const MAX_PHOTOS = 10;
const SAVE_REVIEWER_PHOTOS = false;

// =======================
// HELPERS
// =======================
function slugFolder(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
function slugKebab(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$|/g, "");
}
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function stripHtml(html = "") {
  return html.replace(/<[^>]*>/g, "").trim();
}
function first(comp, type) {
  return comp.find((c) => c.types.includes(type)) || null;
}

// 👇 cleaner: empty string → null
function cleanField(v) {
  return v && String(v).trim() !== "" ? String(v).trim() : null;
}

async function downloadBinaryTo(fileUrl, outPath) {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

async function downloadPhoto(photoRef, index, folder) {
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photo_reference=${encodeURIComponent(
    photoRef
  )}&key=${GOOGLE_API_KEY}`;
  const filePath = path.join(folder, `photo_${index}.jpg`);
  try {
    await downloadBinaryTo(url, filePath);
    console.log(`✅ Saved ${filePath}`);
    return filePath;
  } catch (e) {
    console.error(`❌ Failed photo_${index}: ${e.message}`);
    return null;
  }
}

async function downloadReviewerPhoto(avatarUrl, index, folder) {
  try {
    const filePath = path.join(folder, `reviewer_${index}.jpg`);
    await downloadBinaryTo(avatarUrl, filePath);
    console.log(`👤 Saved ${filePath}`);
    return filePath;
  } catch {
    return null;
  }
}

// =======================
// MAIN
// =======================
async function harvestPlace(placeId) {
  const fields = [
    "name",
    "place_id",
    "formatted_address",
    "address_component",
    "geometry/location",
    "url",
    "website",
    "formatted_phone_number",
    "international_phone_number",
    "rating",
    "user_ratings_total",
    "photos",
    "reviews",
    "opening_hours",
    "type",
    "editorial_summary",
  ].join(",");

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
    placeId
  )}&fields=${fields}&key=${GOOGLE_API_KEY}`;

  const res = await fetch(url);
  const json = await res.json();

  if (!json.result) {
    console.error("❌ No place data:", JSON.stringify(json, null, 2));
    throw new Error("No place data returned from Google");
  }

  const r = json.result;
  const name = r.name || "unknown_place";
  const folder = path.join(__dirname, "Places", slugFolder(name));
  ensureDir(folder);

  // Save raw Google response
  fs.writeFileSync(path.join(folder, "google_raw.json"), JSON.stringify(json, null, 2));

  const lat = r.geometry?.location?.lat ?? null;
  const lng = r.geometry?.location?.lng ?? null;

  // Province + town only — region left blank for enrich
  const province = first(r.address_components || [], "administrative_area_level_1")?.long_name || "";
  const town = first(r.address_components || [], "locality")?.long_name || "";
  const address = r.formatted_address || "";
  const opening_hours = Array.isArray(r.opening_hours?.weekday_text)
    ? r.opening_hours.weekday_text.join("; ")
    : "";

  const slug = slugKebab(name);

  const googleUrl =
    r.url ||
    `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${placeId}`;

  // Photos
  const photos = Array.isArray(r.photos) ? r.photos.slice(0, MAX_PHOTOS) : [];
  const savedPhotoFiles = [];
  for (let i = 0; i < photos.length; i++) {
    const file = await downloadPhoto(photos[i].photo_reference, i + 1, folder);
    if (file) {
      savedPhotoFiles.push({
        file: path.basename(file),
        width: photos[i].width,
        height: photos[i].height,
        attribution_html: (photos[i].html_attributions || [])[0] || "",
        attribution_text: stripHtml((photos[i].html_attributions || [])[0] || ""),
      });
    }
  }

  // Reviews
  const reviewsSrc = Array.isArray(r.reviews) ? r.reviews : [];
  const reviews = [];
  for (let i = 0; i < reviewsSrc.length; i++) {
    const rv = reviewsSrc[i];
    let avatar_local = null;

    if (SAVE_REVIEWER_PHOTOS && rv.profile_photo_url) {
      avatar_local = await downloadReviewerPhoto(rv.profile_photo_url, i + 1, folder);
      if (avatar_local) avatar_local = path.basename(avatar_local);
    }

    reviews.push({
      author_name: rv.author_name || "",
      rating: rv.rating ?? null,
      text: rv.text || "",
      review_time: rv.relative_time_description || "",
      author_photo_url: rv.profile_photo_url || "",
      author_photo_local: avatar_local,
    });
  }

  // Build Strapi-ready JSON
  const placeJson = {
    place_id: r.place_id,
    name,
    slug,
    province,
    region: "", // left blank — handled in enrich
    town,
    address,
    opening_hours,
    rating: r.rating ?? null,
    total_reviews: r.user_ratings_total ?? 0,
    description:
      r.editorial_summary?.overview ||
      `Auto imported from Google Places on ${new Date().toISOString().slice(0, 10)} for ${name}.`,
    latitude: lat,
    longitude: lng,
    contact: {
      phone: cleanField(r.formatted_phone_number || r.international_phone_number),
      email: null, // Google Places doesn’t provide email
      website: cleanField(r.website),
      booking_url: cleanField(r.website),
      google_info: googleUrl, // always has value
      whatsapp: null,
    },
    photos: savedPhotoFiles,
    reviews,
    source: {
      types: r.types || [],
      opening_hours: r.opening_hours || null,
      google_place_url: googleUrl,
      harvested_at: new Date().toISOString(),
    },
  };

  fs.writeFileSync(path.join(folder, "place.json"), JSON.stringify(placeJson, null, 2));
  console.log(`📂 Harvested -> ${folder}`);

  return folder;
}

// Export so addPlace.js can call it
module.exports = { harvestPlace };

// Allow standalone run for testing
if (require.main === module) {
  const PLACE_ID = "ChIJqVeWhyG9eB4RttkoLwb_xKQ"; // demo
  harvestPlace(PLACE_ID).catch((err) => {
    console.error("❌ Harvest failed:", err);
  });
}
