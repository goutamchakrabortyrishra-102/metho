const fs = require("node:fs");
const path = require("node:path");
const { getAllPincodes } = require("indian-pincodes");

const outputDirectory = path.resolve(__dirname, "../public/location-meta");
const states = new Map();

const stateSlug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

for (const row of getAllPincodes()) {
  const state = String(row?.state || "").trim();
  const district = String(row?.district || "").trim();
  const city = String(row?.name || "").trim();
  if (!state || !district) continue;

  if (!states.has(state)) states.set(state, new Map());
  const locations = states.get(state);
  locations.set(`${district}\u0000${city}`, [district, city]);
}

fs.mkdirSync(outputDirectory, { recursive: true });
const slugs = new Set();
for (const [state, locations] of states) {
  const slug = stateSlug(state);
  if (slugs.has(slug)) throw new Error(`Duplicate location state slug: ${state}`);
  slugs.add(slug);
  fs.writeFileSync(
    path.join(outputDirectory, `${slug}.json`),
    JSON.stringify({ state, rows: Array.from(locations.values()) }),
  );
}

fs.writeFileSync(
  path.join(outputDirectory, "index.json"),
  JSON.stringify({ states: Array.from(states.keys()).sort((left, right) => left.localeCompare(right)) }),
);

console.log(`Generated location metadata for ${states.size} states.`);