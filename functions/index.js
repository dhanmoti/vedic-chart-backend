/**
 * Licensed under the GNU AGPL v3.
 *
 * Import function triggers from their respective submodules:
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const fs = require("fs");
const path = require("path");
const {setGlobalOptions} = require("firebase-functions");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const sweph = require("ephemeris");

// For cost control, you can set the maximum number of containers.
// Fixed spacing: removed internal spaces to satisfy object-curly-spacing
setGlobalOptions({maxInstances: 10});

const requiredFields = ["dob", "time", "lat", "lng", "timezone"];

const EPHE_PATH = path.join(
    path.dirname(require.resolve("ephemeris")),
    "ephe",
);

if (fs.existsSync(EPHE_PATH)) {
  sweph.swe_set_ephe_path(EPHE_PATH);
}

sweph.swe_set_sid_mode(sweph.SE_SIDM_LAHIRI, 0, 0);

const PLANETS = {
  Sun: sweph.SE_SUN,
  Moon: sweph.SE_MOON,
  Mars: sweph.SE_MARS,
  Mercury: sweph.SE_MERCURY,
  Jupiter: sweph.SE_JUPITER,
  Venus: sweph.SE_VENUS,
  Saturn: sweph.SE_SATURN,
  Rahu: sweph.SE_MEAN_NODE,
};

const SIDEREAL_FLAGS = sweph.SEFLG_SWIEPH | sweph.SEFLG_SIDEREAL;

const normalizeDegrees = (degrees) => ((degrees % 360) + 360) % 360;

const getSignFromDegrees = (degrees) => Math.floor(normalizeDegrees(degrees) / 30) + 1;

const getDegreeInSign = (degrees) => normalizeDegrees(degrees) % 30;

const getNavamshaSign = (sign, degreesInSign) => {
  const division = Math.floor(degreesInSign / (30 / 9));
  let startSign = 1;
  if ([2, 5, 8, 11].includes(sign)) {
    startSign = 10;
  } else if ([3, 6, 9, 12].includes(sign)) {
    startSign = 7;
  }
  return ((startSign - 1 + division) % 12) + 1;
};

const getDashamshaSign = (sign, degreesInSign) => {
  const division = Math.floor(degreesInSign / 3);
  const isOddSign = sign % 2 === 1;
  const startSign = isOddSign ? sign : ((sign + 7) % 12) + 1;
  return ((startSign - 1 + division) % 12) + 1;
};

const toUtcDate = (dob, time, timezone) => {
  const [year, month, day] = dob.split("-").map(Number);
  const [hour, minute = 0, second = 0] = time.split(":").map(Number);
  let offsetMinutes = 0;

  if (typeof timezone === "number") {
    offsetMinutes = Math.round(timezone * 60);
  } else if (typeof timezone === "string") {
    const match = timezone.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (match) {
      const sign = match[1] === "-" ? -1 : 1;
      const hours = Number(match[2]);
      const minutes = Number(match[3] || "0");
      offsetMinutes = sign * (hours * 60 + minutes);
    }
  }

  const localMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(localMillis - offsetMinutes * 60 * 1000);
};

const getJulianDay = (utcDate) => {
  const hour =
    utcDate.getUTCHours() +
    utcDate.getUTCMinutes() / 60 +
    utcDate.getUTCSeconds() / 3600 +
    utcDate.getUTCMilliseconds() / 3600000;

  return sweph.swe_julday(
      utcDate.getUTCFullYear(),
      utcDate.getUTCMonth() + 1,
      utcDate.getUTCDate(),
      hour,
      sweph.SE_GREG_CAL,
  );
};

const calculatePlanetLongitude = (julianDay, planetId) => {
  const result = sweph.swe_calc_ut(julianDay, planetId, SIDEREAL_FLAGS);
  if (result.error || result.serr) {
    throw new Error(result.error || result.serr);
  }
  return result.data[0];
};

const calculateAscendant = (julianDay, lat, lng) => {
  const result = sweph.swe_houses_ex(
      julianDay,
      SIDEREAL_FLAGS,
      lat,
      lng,
      "W",
  );
  if (result.error || result.serr) {
    throw new Error(result.error || result.serr);
  }
  return result.ascmc[0];
};

const buildChart = (julianDay, lat, lng) => {
  const ascendant = calculateAscendant(julianDay, lat, lng);
  const ascendantSign = getSignFromDegrees(ascendant);

  const charts = {
    D1: {},
    D9: {},
    D10: {},
  };

  Object.entries(PLANETS).forEach(([name, planetId]) => {
    const longitude = calculatePlanetLongitude(julianDay, planetId);
    const sign = getSignFromDegrees(longitude);
    const degreesInSign = getDegreeInSign(longitude);
    const house = ((sign - ascendantSign + 12) % 12) + 1;

    charts.D1[name] = {sign, house};
    charts.D9[name] = {sign: getNavamshaSign(sign, degreesInSign)};
    charts.D10[name] = {sign: getDashamshaSign(sign, degreesInSign)};
  });

  const ketuLongitude = normalizeDegrees(
      calculatePlanetLongitude(julianDay, sweph.SE_MEAN_NODE) + 180,
  );
  const ketuSign = getSignFromDegrees(ketuLongitude);
  const ketuDegreesInSign = getDegreeInSign(ketuLongitude);
  const ketuHouse = ((ketuSign - ascendantSign + 12) % 12) + 1;

  charts.D1.Ketu = {sign: ketuSign, house: ketuHouse};
  charts.D9.Ketu = {sign: getNavamshaSign(ketuSign, ketuDegreesInSign)};
  charts.D10.Ketu = {sign: getDashamshaSign(ketuSign, ketuDegreesInSign)};

  return {
    status: "success",
    metadata: {
      ascendant_sign: ascendantSign,
      ascendant_degrees: normalizeDegrees(ascendant),
    },
    charts,
  };
};

exports.getBirthChart = onCall({cors: true}, (request) => {
  const missingFields = requiredFields.filter(
      (field) => request.data?.[field] === undefined,
  );

  if (missingFields.length) {
    throw new HttpsError(
        "invalid-argument",
        `Missing required fields: ${missingFields.join(", ")}`,
    );
  }

  const utcDate = toUtcDate(
      request.data.dob,
      request.data.time,
      request.data.timezone,
  );
  const julianDay = getJulianDay(utcDate);

  return buildChart(julianDay, request.data.lat, request.data.lng);
});
