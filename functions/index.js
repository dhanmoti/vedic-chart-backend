/**
 * Licensed under the GNU AGPL v3.
 */

import * as SwissEphModule from "@fusionstrings/swiss-eph";
import {setGlobalOptions} from "firebase-functions";
import {HttpsError, onCall} from "firebase-functions/v2/https";

setGlobalOptions({maxInstances: 10});

const REQUIRED_FIELDS = ["dob", "time", "lat", "lng", "timezone"];

const PLANETS = {
  Sun: ["SE_SUN", "SUN"],
  Moon: ["SE_MOON", "MOON"],
  Mars: ["SE_MARS", "MARS"],
  Mercury: ["SE_MERCURY", "MERCURY"],
  Jupiter: ["SE_JUPITER", "JUPITER"],
  Venus: ["SE_VENUS", "VENUS"],
  Saturn: ["SE_SATURN", "SATURN"],
  Rahu: ["SE_MEAN_NODE", "MEAN_NODE"],
};

const getSwissEph = () => SwissEphModule.default ?? SwissEphModule;

const getConst = (swe, names) => {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(swe, name)) {
      return swe[name];
    }
  }
  throw new Error(`SwissEph constant not found: ${names.join("/")}`);
};

const normalizeDegrees = (degrees) => {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
};

const signFromLongitude = (degrees) => {
  const normalized = normalizeDegrees(degrees);
  return Math.floor(normalized / 30) + 1;
};

const divisionalSign = (degrees, division) => {
  const normalized = normalizeDegrees(degrees);
  const signIndex = Math.floor(normalized / 30);
  const segmentSize = 30 / division;
  const segmentIndex = Math.floor((normalized % 30) / segmentSize);
  return ((signIndex * division + segmentIndex) % 12) + 1;
};

const parseDateTime = (dob, time) => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!dateMatch) {
    throw new Error("dob must be in YYYY-MM-DD format");
  }

  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!timeMatch) {
    throw new Error("time must be in HH:mm or HH:mm:ss format");
  }

  return {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: Number(timeMatch[3] ?? 0),
  };
};

const parseTimezoneOffsetMinutes = (timezone) => {
  if (typeof timezone === "number" && Number.isFinite(timezone)) {
    return timezone * 60;
  }

  if (typeof timezone === "string") {
    const trimmed = timezone.trim();
    const numeric = /^([+-]?\d+(?:\.\d+)?)$/.exec(trimmed);
    if (numeric) {
      return Number(numeric[1]) * 60;
    }

    const timeMatch = /^([+-]?)(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (timeMatch) {
      const sign = timeMatch[1] === "-" ? -1 : 1;
      const hours = Number(timeMatch[2]);
      const minutes = Number(timeMatch[3]);
      return sign * (hours * 60 + minutes);
    }
  }

  throw new Error("timezone must be a number or an offset like +05:30");
};

const toUtcDate = (localDateParts, timezoneOffsetMinutes) => {
  const {year, month, day, hour, minute, second} = localDateParts;
  const localUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(localUtc - timezoneOffsetMinutes * 60 * 1000);
};

const julianDay = (swe, utcDate) => {
  const year = utcDate.getUTCFullYear();
  const month = utcDate.getUTCMonth() + 1;
  const day = utcDate.getUTCDate();
  const hour =
    utcDate.getUTCHours() +
    utcDate.getUTCMinutes() / 60 +
    utcDate.getUTCSeconds() / 3600 +
    utcDate.getUTCMilliseconds() / 3600000;

  const julday =
    swe.julday ?? swe.julday_ut ?? swe.juldayUt ?? swe.juldayUT;

  if (typeof julday === "function") {
    const gregFlag = swe.GREG_CAL ?? swe.SE_GREG_CAL ?? 1;
    return julday.call(swe, year, month, day, hour, gregFlag);
  }

  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jdn =
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045;
  return jdn + hour / 24 - 0.5;
};

const resolveCalcFlags = (swe) => {
  const sidereal = getConst(swe, ["SEFLG_SIDEREAL", "FLG_SIDEREAL"]);
  const swieph = getConst(swe, ["SEFLG_SWIEPH", "FLG_SWIEPH"]);
  const speed = getConst(swe, ["SEFLG_SPEED", "FLG_SPEED"]);
  return sidereal | swieph | speed;
};

const setSiderealMode = (swe) => {
  const setMode = swe.set_sid_mode ?? swe.setSidMode ?? swe.setSiderealMode;
  if (typeof setMode !== "function") {
    throw new Error("SwissEph sidereal mode setter not available");
  }
  const sidMode = getConst(swe, ["SIDM_LAHIRI", "SE_SIDM_LAHIRI"]);
  setMode.call(swe, sidMode, 0, 0);
};

const calcLongitude = (swe, julianDayUt, planetId, flags) => {
  const calc = swe.calc_ut ?? swe.calcUt ?? swe.calcUT;
  if (typeof calc !== "function") {
    throw new Error("SwissEph calc_ut not available");
  }

  const result = calc.call(swe, julianDayUt, planetId, flags);

  if (Array.isArray(result)) {
    return result[0];
  }

  if (Array.isArray(result?.position)) {
    return result.position[0];
  }

  if (Array.isArray(result?.data)) {
    return result.data[0];
  }

  if (typeof result?.longitude === "number") {
    return result.longitude;
  }

  if (typeof result?.lon === "number") {
    return result.lon;
  }

  throw new Error("SwissEph calc_ut result missing longitude");
};

const calcAscendantLongitude = (swe, julianDayUt, lat, lng) => {
  const houses = swe.houses ?? swe.houses_ex ?? swe.housesEx ?? swe.housesEx;
  if (typeof houses !== "function") {
    throw new Error("SwissEph houses function not available");
  }

  const result = houses.call(swe, julianDayUt, lat, lng, "W");

  if (Array.isArray(result?.ascmc)) {
    return result.ascmc[0];
  }

  if (typeof result?.ascmc === "number") {
    return result.ascmc;
  }

  if (typeof result?.ascendant === "number") {
    return result.ascendant;
  }

  if (Array.isArray(result) && Array.isArray(result[1])) {
    return result[1][0];
  }

  throw new Error("SwissEph houses result missing ascendant");
};

const calculateCharts = ({dob, time, lat, lng, timezone}) => {
  const swe = getSwissEph();
  setSiderealMode(swe);

  const dateParts = parseDateTime(dob, time);
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(timezone);
  const utcDate = toUtcDate(dateParts, timezoneOffsetMinutes);
  const jdUt = julianDay(swe, utcDate);

  const flags = resolveCalcFlags(swe);

  const ascendantLongitude = calcAscendantLongitude(swe, jdUt, lat, lng);
  const ascendantSign = signFromLongitude(ascendantLongitude);

  const chartLongitudes = {};
  for (const [name, constNames] of Object.entries(PLANETS)) {
    const planetId = getConst(swe, constNames);
    chartLongitudes[name] = calcLongitude(swe, jdUt, planetId, flags);
  }

  const rahuLongitude = chartLongitudes.Rahu;
  const ketuLongitude = normalizeDegrees(rahuLongitude + 180);
  chartLongitudes.Ketu = ketuLongitude;

  const buildChart = (division) => {
    const chart = {};
    for (const [name, longitude] of Object.entries(chartLongitudes)) {
      chart[name] = {
        sign: division === 1
          ? signFromLongitude(longitude)
          : divisionalSign(longitude, division),
      };
    }
    return chart;
  };

  return {
    status: "success",
    metadata: {
      ascendant_sign: ascendantSign,
      ascendant_degrees: normalizeDegrees(ascendantLongitude),
    },
    charts: {
      D1: buildChart(1),
      D9: buildChart(9),
      D10: buildChart(10),
    },
  };
};

export const getBirthChart = onCall({cors: true}, (request) => {
  const missingFields = REQUIRED_FIELDS.filter(
    (field) => request.data?.[field] === undefined,
  );

  if (missingFields.length) {
    throw new HttpsError(
      "invalid-argument",
      `Missing required fields: ${missingFields.join(", ")}`,
    );
  }

  const lat = Number(request.data.lat);
  const lng = Number(request.data.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new HttpsError("invalid-argument", "lat and lng must be numbers");
  }

  try {
    return calculateCharts({
      dob: request.data.dob,
      time: request.data.time,
      lat,
      lng,
      timezone: request.data.timezone,
    });
  } catch (error) {
    throw new HttpsError(
      "invalid-argument",
      error instanceof Error ? error.message : "Invalid request",
    );
  }
});
