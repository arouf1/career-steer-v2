// One-shot: convert the raw Google Ads geo-target dump (locations.json,
// ~210k records) into a JSONL file Convex will accept via
// `npx convex import --table locations`. Run once, then delete both files.

import { readFileSync, createWriteStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const inputPath = resolve(repoRoot, "locations.json");
const outputPath = resolve(repoRoot, "locations-import.jsonl");

const ALLOWED_TARGET_TYPES = new Set([
  "Airport", "Autonomous Community", "Barrio", "Borough", "Canton", "City",
  "City Region", "Congressional District", "Country", "County", "DMA Region",
  "Department", "District", "Governorate", "Municipality",
  "Municipality District", "National Park", "Neighborhood", "Okrug",
  "Postal Code", "Prefecture", "Province", "Quarter", "Region", "State",
  "Sub-District", "Sub-Ward", "TV Region", "Territory", "Union Territory",
  "University",
]);

// Source canonical_name has no space after commas: "Dubai,Dubai,UAE".
// Insert one space after each comma that's followed by a non-space char.
const spaceCommas = (s) => s.replace(/,(?=\S)/g, ", ");

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
console.log(`Read ${raw.length} records from locations.json`);

const out = createWriteStream(outputPath, { encoding: "utf8" });
let written = 0;
let skipped = 0;

for (const r of raw) {
  if (!ALLOWED_TARGET_TYPES.has(r.target_type)) {
    skipped++;
    continue;
  }
  // 3 source records (all Neighborhood) have null gps — skip rather than
  // make the schema field optional for everyone.
  if (!Array.isArray(r.gps) || r.gps.length !== 2) {
    skipped++;
    continue;
  }
  // gps is [longitude, latitude] in the source.
  const [lon, lat] = r.gps;
  const row = {
    externalId: r.id,
    googleId: r.google_id,
    name: r.name,
    canonicalName: spaceCommas(r.canonical_name),
    countryCode: r.country_code,
    targetType: r.target_type,
    reach: r.reach,
    gps: { lat, lon },
  };
  if (r.google_parent_id !== undefined && r.google_parent_id !== null) {
    row.googleParentId = r.google_parent_id;
  }
  out.write(JSON.stringify(row) + "\n");
  written++;
}

out.end(() => {
  console.log(`Wrote ${written} rows to ${outputPath}`);
  if (skipped > 0) {
    console.log(`Skipped ${skipped} rows with unrecognized target_type`);
  }
});
