const path = require("path");
const swisseph = require("swisseph");
const {normalizeDegrees} = require("./math");

const EPHEMERIS_PATH = path.join(__dirname, "..", "ephe");
const SWISS_FLAGS = swisseph.SEFLG_SWIEPH | swisseph.SEFLG_SIDEREAL;
const HOUSE_SYSTEM = "P";

const PLANET_CONFIGS = [
  {name: "Sun", id: swisseph.SE_SUN},
  {name: "Moon", id: swisseph.SE_MOON},
  {name: "Mercury", id: swisseph.SE_MERCURY},
  {name: "Venus", id: swisseph.SE_VENUS},
  {name: "Mars", id: swisseph.SE_MARS},
  {name: "Jupiter", id: swisseph.SE_JUPITER},
  {name: "Saturn", id: swisseph.SE_SATURN},
];

let swissInitialized = false;

const initSwissEphemeris = () => {
  if (swissInitialized) return;
  swisseph.swe_set_ephe_path(EPHEMERIS_PATH);
  swisseph.swe_set_sid_mode(swisseph.SE_SIDM_LAHIRI, 0, 0);
  swissInitialized = true;
};

const callSwissephAsync = (fn, args) => new Promise((resolve, reject) => {
  let resolved = false;
  const callback = (result) => {
    if (resolved) return;
    resolved = true;
    if (result && result.error) {
      reject(new Error(result.error));
      return;
    }
    resolve(result);
  };
  const directResult = fn(...args, callback);
  if (directResult !== undefined && !resolved) {
    resolved = true;
    if (directResult && directResult.error) {
      reject(new Error(directResult.error));
      return;
    }
    resolve(directResult);
  }
});

const callSwissephSync = (fn, args) => {
  const result = fn(...args);
  if (result && result.error) {
    throw new Error(result.error);
  }
  return result;
};

const extractLongitude = (result, label) => {
  if (typeof result === "number") return result;
  if (Array.isArray(result) && typeof result[0] === "number") {
    return result[0];
  }
  if (result && typeof result.longitude === "number") {
    return result.longitude;
  }
  if (result && Array.isArray(result.data) && typeof result.data[0] === "number") {
    return result.data[0];
  }
  throw new Error(`Unable to read longitude for ${label}`);
};

const extractAscmc = (result) => {
  if (result && Array.isArray(result.ascmc)) return result.ascmc;
  if (Array.isArray(result) && Array.isArray(result[1])) return result[1];
  if (result && Array.isArray(result.ascmc)) return result.ascmc;
  throw new Error("Unable to read ascmc values from swe_houses");
};

const getJulianDay = async (date) => {
  initSwissEphemeris();
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hour = date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3600000;
  const result = callSwissephSync(
      swisseph.swe_julday,
      [year, month, day, hour, swisseph.SE_GREG_CAL],
  );
  return typeof result === "number" ? result : result.jd;
};

const getAyanamsha = async (jd) => {
  initSwissEphemeris();
  const result = callSwissephSync(swisseph.swe_get_ayanamsa_ut, [jd]);
  return typeof result === "number" ? result : result.ayanamsha;
};

const getBodyLongitude = async (jd, bodyId) => {
  initSwissEphemeris();
  const result = await callSwissephAsync(
      swisseph.swe_calc_ut,
      [jd, bodyId, SWISS_FLAGS],
  );
  return normalizeDegrees(extractLongitude(result, bodyId));
};

const getAscendant = async (jd, lat, lng) => {
  initSwissEphemeris();
  const hasHousesEx = typeof swisseph.swe_houses_ex === "function";
  const args = hasHousesEx ?
    [jd, SWISS_FLAGS, lat, lng, HOUSE_SYSTEM] :
    [jd, lat, lng, HOUSE_SYSTEM];
  const result = await callSwissephAsync(
      hasHousesEx ? swisseph.swe_houses_ex : swisseph.swe_houses,
      args,
  );
  const ascmc = extractAscmc(result);
  let ascendant = ascmc[swisseph.SE_ASC || 0];
  if (!hasHousesEx) {
    const ayanamsha = await getAyanamsha(jd);
    ascendant = normalizeDegrees(ascendant - ayanamsha);
  }
  return normalizeDegrees(ascendant);
};

const getSwissPositions = async ({date, lat, lng}) => {
  const jd = await getJulianDay(date);
  const ayanamsha = await getAyanamsha(jd);
  const ascendant = await getAscendant(jd, lat, lng);
  const bodies = {};
  for (const planet of PLANET_CONFIGS) {
    bodies[planet.name] = await getBodyLongitude(jd, planet.id);
  }
  const rahuLongitude = await getBodyLongitude(jd, swisseph.SE_TRUE_NODE);
  bodies.Rahu = rahuLongitude;
  bodies.Ketu = normalizeDegrees(rahuLongitude + 180);
  return {jd, ayanamsha, ascendant, bodies};
};

module.exports = {
  PLANET_CONFIGS,
  SWISS_FLAGS,
  getJulianDay,
  getAyanamsha,
  getBodyLongitude,
  getAscendant,
  getSwissPositions,
};
