let statesPromise;
const stateMetaPromises = new Map();

const stateSlug = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const fetchJson = async (path) => {
  const response = await fetch(`${process.env.PUBLIC_URL || ""}/location-meta/${path}`);
  if (!response.ok) throw new Error(`Location data request failed (${response.status})`);
  return response.json();
};

export const buildIndiaLocationMetaForState = (state, rows) => {
  const districts = new Set();
  const citiesByDistrict = new Map();
  const stateKey = String(state || "").trim();

  for (const row of Array.isArray(rows) ? rows : []) {
    const district = String(row?.[0] || "").trim();
    const city = String(row?.[1] || "").trim();
    if (!district) continue;
    districts.add(district);
    if (city) {
      if (!citiesByDistrict.has(district)) citiesByDistrict.set(district, new Set());
      citiesByDistrict.get(district).add(city);
    }
  }

  return {
    districtsByState: { [stateKey]: Array.from(districts).sort((a, b) => a.localeCompare(b)) },
    citiesByStateDistrict: Object.fromEntries(
      Array.from(citiesByDistrict, ([district, cities]) => [
        `${stateKey.toLowerCase()}||${district.toLowerCase()}`,
        Array.from(cities).sort((a, b) => a.localeCompare(b)),
      ]),
    ),
  };
};

export const loadIndiaLocationStates = () => {
  if (!statesPromise) {
    statesPromise = fetchJson("index.json")
      .then((payload) => (Array.isArray(payload?.states) ? payload.states : []))
      .catch((error) => {
        statesPromise = null;
        throw error;
      });
  }
  return statesPromise;
};

export const loadIndiaLocationMetaForState = async (state) => {
  const stateName = String(state || "").trim();
  const states = await loadIndiaLocationStates();
  if (!stateName) return { states, districtsByState: {}, citiesByStateDistrict: {} };

  const slug = stateSlug(stateName);
  if (!stateMetaPromises.has(slug)) {
    stateMetaPromises.set(slug, fetchJson(`${slug}.json`).catch((error) => {
      stateMetaPromises.delete(slug);
      throw error;
    }));
  }
  const payload = await stateMetaPromises.get(slug);
  return {
    states,
    ...buildIndiaLocationMetaForState(stateName, payload?.rows),
  };
};