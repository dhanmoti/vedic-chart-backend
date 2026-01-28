const J2000 = 2451545.0;

const normalizeDegrees = (degrees) => ((degrees % 360) + 360) % 360;

const toJulianDay = (date) => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds() + date.getUTCMilliseconds() / 1000;
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jdDay = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  const dayFraction = (hour - 12) / 24 + minute / 1440 + second / 86400;
  return jdDay + dayFraction;
};

const meanObliquity = (jd) => {
  const T = (jd - J2000) / 36525.0;
  const seconds = 21.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
  const degrees = 23 + 26 / 60 + seconds / 3600;
  return degrees * (Math.PI / 180);
};

const greenwichSiderealTime = (jd) => {
  const T = (jd - J2000) / 36525.0;
  let gmst = 280.46061837 + 360.98564736629 * (jd - J2000) + 0.000387933 * T * T - (T * T * T) / 38710000;
  gmst = normalizeDegrees(gmst);
  return gmst;
};

const meanNodeLongitude = (jd) => {
  const T = (jd - J2000) / 36525.0;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T2 * T2;
  const omega = 125.0445550 - 1934.1361849 * T + 0.0020762 * T2 + (T3 / 467410) - (T4 / 60616000);
  return normalizeDegrees(omega) * (Math.PI / 180);
};

const toEclipticLongitude = (vector, jd) => {
  const eps = meanObliquity(jd);
  const x = vector[0];
  const y = vector[1] * Math.cos(eps) + vector[2] * Math.sin(eps);
  const lon = Math.atan2(y, x);
  return normalizeDegrees(lon * (180 / Math.PI));
};

module.exports = {
  J2000,
  normalizeDegrees,
  toJulianDay,
  meanObliquity,
  greenwichSiderealTime,
  meanNodeLongitude,
  toEclipticLongitude,
};
