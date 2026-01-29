const {
  SEI_FLG_HELIO,
  SEI_SUN,
  SEI_MOON,
} = require("../ephemeris/SwissEphemerisFile");
const {zodiac, dasha, tithi} = require("./constants");
const {
  normalizeDegrees,
  meanNodeLongitude,
  toEclipticLongitude,
} = require("./math");

const {SIGN_NAMES, NAKSHATRA_NAMES, DIGNITY_TABLE} = zodiac;
const {DASA_LORDS, DASA_YEARS} = dasha;
const {TITHI_NAMES} = tithi;

const getSign = (degrees) => Math.floor(normalizeDegrees(degrees) / 30) + 1;
const getDegInSign = (degrees) => normalizeDegrees(degrees) % 30;

const getLahiriAyanamsha = (jd) => {
  const T = (jd - 2415020.0) / 36525.0;
  return 22.460148 + 1.396042 * T + 0.000308 * T * T;
};

const getPlanetLongitude = (ipli, jd, ephemerisCache) => {
  const planetFile = ephemerisCache.planet;
  const moonFile = ephemerisCache.moon;
  if (ipli === SEI_MOON) {
    const moonVec = moonFile.evaluate(SEI_MOON, jd);
    return toEclipticLongitude(moonVec, jd);
  }
  const earthVec = planetFile.evaluate(SEI_SUN, jd);
  if (ipli === SEI_SUN) {
    return toEclipticLongitude(earthVec.map((v) => -v), jd);
  }
  const planetVec = planetFile.evaluate(ipli, jd);
  const iflg = planetFile.getIfFlags(ipli);
  if (iflg & SEI_FLG_HELIO) {
    const geoVec = planetVec.map((v, i) => v - earthVec[i]);
    return toEclipticLongitude(geoVec, jd);
  }
  return toEclipticLongitude(planetVec, jd);
};

const getNavamshaSign = (sign, deg) => {
  const div = Math.floor(deg / (30 / 9));
  let start = 1;
  if ([2, 5, 8, 11].includes(sign)) start = 10;
  else if ([3, 6, 9, 12].includes(sign)) start = 7;
  return ((start - 1 + div) % 12) + 1;
};

const getDashamshaSign = (sign, deg) => {
  const div = Math.floor(deg / 3);
  const start = (sign % 2 === 1) ? sign : ((sign + 8) % 12) + 1;
  return ((start - 1 + div) % 12) + 1;
};

const getNakshatraDetails = (siderealLongitude) => {
  const normalized = normalizeDegrees(siderealLongitude);
  const nakshatraSpan = 13 + 20 / 60;
  const padaSpan = 3 + 20 / 60;
  const index = Math.floor(normalized / nakshatraSpan);
  const withinNakshatra = normalized - index * nakshatraSpan;
  const pada = Math.floor(withinNakshatra / padaSpan) + 1;
  const degreesIntoNakshatra = withinNakshatra;
  return {
    index,
    name: NAKSHATRA_NAMES[index],
    pada,
    degreesIntoNakshatra,
  };
};

const formatDms = (deg) => {
  const totalSeconds = Math.round(deg * 3600);
  const degrees = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    `${degrees}°`,
    `${minutes.toString().padStart(2, "0")}'`,
    `${seconds.toString().padStart(2, "0")}"`,
  ].join("");
};

const getTithi = (moonLongitude, sunLongitude) => {
  const diff = normalizeDegrees(moonLongitude - sunLongitude);
  const tithiIndex = Math.floor(diff / 12);
  const phase = diff < 180 ? "Shukla" : "Krishna";
  const name = TITHI_NAMES[tithiIndex % 15];
  return `${phase} ${name}`;
};

const getVikramSamvatYear = (date) => date.getUTCFullYear() + 57;

const getPlanetStatus = (planet, sign) => {
  const dignity = DIGNITY_TABLE[planet];
  if (!dignity) return "Friend";
  if (dignity.debilitation === sign) return "Debil.";
  if (dignity.exaltation === sign) return "Great Friend";
  if (dignity.own.includes(sign)) return "Own";
  if (dignity.enemies.includes(sign)) return "Enemy";
  return "Friend";
};

const buildVimshottariDasha = (moonLongitude) => {
  const nakshatra = getNakshatraDetails(moonLongitude);
  const lordIndex = nakshatra.index % DASA_LORDS.length;
  const mahaLord = DASA_LORDS[lordIndex];
  const nakshatraSpan = 13 + 20 / 60;
  const progress = nakshatra.degreesIntoNakshatra / nakshatraSpan;
  const mahaDuration = DASA_YEARS[mahaLord];
  const elapsedYears = mahaDuration * progress;
  const balanceYears = mahaDuration - elapsedYears;

  const antarSequence = [];
  for (let i = 0; i < DASA_LORDS.length; i += 1) {
    antarSequence.push(DASA_LORDS[(lordIndex + i) % DASA_LORDS.length]);
  }

  let remainingElapsed = elapsedYears;
  let antarLord = antarSequence[0];
  let antarDuration = 0;
  for (let i = 0; i < antarSequence.length; i += 1) {
    const lord = antarSequence[i];
    const duration = (mahaDuration * DASA_YEARS[lord]) / 120;
    if (remainingElapsed <= duration + 1e-6) {
      antarLord = lord;
      antarDuration = duration;
      break;
    }
    remainingElapsed -= duration;
  }

  const pratyantarSequence = [];
  const antarIndex = DASA_LORDS.indexOf(antarLord);
  for (let i = 0; i < DASA_LORDS.length; i += 1) {
    pratyantarSequence.push(DASA_LORDS[(antarIndex + i) % DASA_LORDS.length]);
  }
  let pratyantarLord = pratyantarSequence[0];
  let remainingAntarElapsed = remainingElapsed;
  for (let i = 0; i < pratyantarSequence.length; i += 1) {
    const lord = pratyantarSequence[i];
    const duration = (antarDuration * DASA_YEARS[lord]) / 120;
    if (remainingAntarElapsed <= duration + 1e-6) {
      pratyantarLord = lord;
      break;
    }
    remainingAntarElapsed -= duration;
  }

  const totalDays = Math.round(balanceYears * 360);
  const years = Math.floor(totalDays / 360);
  const months = Math.floor((totalDays % 360) / 30);
  const days = totalDays % 30;

  return {
    current: `${mahaLord}-${antarLord}-${pratyantarLord}`,
    balance: {years, months, days},
  };
};

const buildSripatiBhava = (ascendantLongitude) => {
  const bhavas = [];
  for (let house = 1; house <= 12; house += 1) {
    const madhya = normalizeDegrees(ascendantLongitude + (house - 1) * 30);
    const arambha = normalizeDegrees(madhya - 15);
    const antya = normalizeDegrees(madhya + 15);
    bhavas.push({
      house,
      arambha: arambha,
      madhya: madhya,
      antya: antya,
    });
  }
  return bhavas;
};

const getNodesSidereal = (jd, ayanamsha) => {
  const rahuTropical = normalizeDegrees(
      meanNodeLongitude(jd) * (180 / Math.PI),
  );
  const rahuSidereal = normalizeDegrees(rahuTropical - ayanamsha);
  const ketuSidereal = normalizeDegrees(rahuSidereal + 180);
  return {rahuSidereal, ketuSidereal};
};

module.exports = {
  SIGN_NAMES,
  getSign,
  getDegInSign,
  getLahiriAyanamsha,
  getPlanetLongitude,
  getNavamshaSign,
  getDashamshaSign,
  getNakshatraDetails,
  formatDms,
  getTithi,
  getVikramSamvatYear,
  getPlanetStatus,
  buildVimshottariDasha,
  buildSripatiBhava,
  getNodesSidereal,
};
