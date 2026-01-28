const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
    SwissEphemerisFile,
    SEI_FLG_HELIO,
    SEI_SUN,
    SEI_MOON,
    SEI_MERCURY,
    SEI_VENUS,
    SEI_MARS,
    SEI_JUPITER,
    SEI_SATURN,
    EPHEMERIS_FILES
} = require("./ephemeris/SwissEphemerisFile");

setGlobalOptions({ maxInstances: 10 });

const J2000 = 2451545.0;
const ephemerisCache = {
    planet: new SwissEphemerisFile(EPHEMERIS_FILES.planet),
    moon: new SwissEphemerisFile(EPHEMERIS_FILES.moon)
};

const normalizeDegrees = (d) => ((d % 360) + 360) % 360;
const getSign = (d) => Math.floor(normalizeDegrees(d) / 30) + 1;
const getDegInSign = (d) => normalizeDegrees(d) % 30;
const SIGN_NAMES = [
    "Aries",
    "Taurus",
    "Gemini",
    "Cancer",
    "Leo",
    "Virgo",
    "Libra",
    "Scorpio",
    "Sagittarius",
    "Capricorn",
    "Aquarius",
    "Pisces"
];
const NAKSHATRA_NAMES = [
    "Ashwini",
    "Bharani",
    "Krittika",
    "Rohini",
    "Mrigashirsha",
    "Ardra",
    "Punarvasu",
    "Pushya",
    "Ashlesha",
    "Magha",
    "Purva Phalguni",
    "Uttara Phalguni",
    "Hasta",
    "Chitra",
    "Swati",
    "Vishakha",
    "Anuradha",
    "Jyeshtha",
    "Mula",
    "Purva Ashadha",
    "Uttara Ashadha",
    "Shravana",
    "Dhanishta",
    "Shatabhisha",
    "Purva Bhadrapada",
    "Uttara Bhadrapada",
    "Revati"
];
const DASA_LORDS = ["Ketu", "Venus", "Sun", "Moon", "Mars", "Rahu", "Jupiter", "Saturn", "Mercury"];
const DASA_YEARS = {
    Ketu: 7,
    Venus: 20,
    Sun: 6,
    Moon: 10,
    Mars: 7,
    Rahu: 18,
    Jupiter: 16,
    Saturn: 19,
    Mercury: 17
};
const TITHI_NAMES = [
    "Pratipada",
    "Dwitiya",
    "Tritiya",
    "Chaturthi",
    "Panchami",
    "Shashthi",
    "Saptami",
    "Ashtami",
    "Navami",
    "Dashami",
    "Ekadashi",
    "Dwadashi",
    "Trayodashi",
    "Chaturdashi",
    "Purnima"
];
const AVAKHADA_MAP = [
    { varna: "Kshatriya", vashya: "Chatushpada", yoni: "Ashwa", gana: "Deva", nadi: "Adi", tatwa: "Vayu" },
    { varna: "Shudra", vashya: "Chatushpada", yoni: "Gaja", gana: "Manushya", nadi: "Madhya", tatwa: "Prithvi" },
    { varna: "Brahmin", vashya: "Chatushpada", yoni: "Mesh", gana: "Rakshasa", nadi: "Antya", tatwa: "Agni" },
    { varna: "Vaishya", vashya: "Chatushpada", yoni: "Sarpa", gana: "Manushya", nadi: "Adi", tatwa: "Prithvi" },
    { varna: "Shudra", vashya: "Chatushpada", yoni: "Sarpa", gana: "Deva", nadi: "Madhya", tatwa: "Prithvi" },
    { varna: "Vaishya", vashya: "Manava", yoni: "Shwan", gana: "Manushya", nadi: "Antya", tatwa: "Vayu" },
    { varna: "Kshatriya", vashya: "Manava", yoni: "Marjara", gana: "Deva", nadi: "Adi", tatwa: "Vayu" },
    { varna: "Kshatriya", vashya: "Manava", yoni: "Mesh", gana: "Deva", nadi: "Madhya", tatwa: "Jala" },
    { varna: "Brahmin", vashya: "Jalachara", yoni: "Marjara", gana: "Rakshasa", nadi: "Antya", tatwa: "Jala" },
    { varna: "Shudra", vashya: "Manava", yoni: "Mushaka", gana: "Rakshasa", nadi: "Adi", tatwa: "Agni" },
    { varna: "Brahmin", vashya: "Manava", yoni: "Mushaka", gana: "Manushya", nadi: "Madhya", tatwa: "Agni" },
    { varna: "Kshatriya", vashya: "Manava", yoni: "Gau", gana: "Manushya", nadi: "Antya", tatwa: "Agni" },
    { varna: "Brahmin", vashya: "Manava", yoni: "Mahisha", gana: "Deva", nadi: "Adi", tatwa: "Jala" },
    { varna: "Shudra", vashya: "Vanachara", yoni: "Vyaghra", gana: "Rakshasa", nadi: "Madhya", tatwa: "Agni" },
    { varna: "Brahmin", vashya: "Vanachara", yoni: "Mahisha", gana: "Deva", nadi: "Antya", tatwa: "Vayu" },
    { varna: "Brahmin", vashya: "Manava", yoni: "Vyaghra", gana: "Rakshasa", nadi: "Adi", tatwa: "Agni" },
    { varna: "Shudra", vashya: "Manava", yoni: "Mriga", gana: "Deva", nadi: "Madhya", tatwa: "Jala" },
    { varna: "Shudra", vashya: "Manava", yoni: "Mriga", gana: "Rakshasa", nadi: "Antya", tatwa: "Jala" },
    { varna: "Brahmin", vashya: "Vanachara", yoni: "Shwan", gana: "Rakshasa", nadi: "Adi", tatwa: "Vayu" },
    { varna: "Kshatriya", vashya: "Vanachara", yoni: "Vanara", gana: "Manushya", nadi: "Madhya", tatwa: "Vayu" },
    { varna: "Kshatriya", vashya: "Vanachara", yoni: "Nakula", gana: "Manushya", nadi: "Antya", tatwa: "Vayu" },
    { varna: "Shudra", vashya: "Vanachara", yoni: "Vanara", gana: "Deva", nadi: "Adi", tatwa: "Jala" },
    { varna: "Shudra", vashya: "Rakshasa", yoni: "Simha", gana: "Rakshasa", nadi: "Madhya", tatwa: "Agni" },
    { varna: "Brahmin", vashya: "Rakshasa", yoni: "Ashwa", gana: "Rakshasa", nadi: "Antya", tatwa: "Akasha" },
    { varna: "Brahmin", vashya: "Manava", yoni: "Simha", gana: "Manushya", nadi: "Adi", tatwa: "Akasha" },
    { varna: "Kshatriya", vashya: "Manava", yoni: "Gau", gana: "Manushya", nadi: "Madhya", tatwa: "Akasha" },
    { varna: "Vaishya", vashya: "Manava", yoni: "Gau", gana: "Deva", nadi: "Antya", tatwa: "Jala" }
];
const DIGNITY_TABLE = {
    Sun: {
        own: [5],
        exaltation: 1,
        debilitation: 7,
        friends: [1, 4, 9],
        enemies: [2, 10, 11, 6]
    },
    Moon: {
        own: [4],
        exaltation: 2,
        debilitation: 8,
        friends: [1, 4, 5],
        enemies: [9, 10, 11]
    },
    Mars: {
        own: [1, 8],
        exaltation: 10,
        debilitation: 4,
        friends: [1, 4, 5],
        enemies: [2, 6]
    },
    Mercury: {
        own: [3, 6],
        exaltation: 6,
        debilitation: 12,
        friends: [3, 6, 7],
        enemies: [5, 9]
    },
    Jupiter: {
        own: [9, 12],
        exaltation: 4,
        debilitation: 10,
        friends: [1, 4, 5],
        enemies: [2, 6, 7]
    },
    Venus: {
        own: [2, 7],
        exaltation: 12,
        debilitation: 6,
        friends: [2, 7, 10],
        enemies: [5, 9]
    },
    Saturn: {
        own: [10, 11],
        exaltation: 7,
        debilitation: 1,
        friends: [2, 6, 7],
        enemies: [1, 4, 5]
    }
};

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

const getLahiriAyanamsha = (jd) => {
    const T = (jd - 2415020.0) / 36525.0;
    return 22.460148 + 1.396042 * T + 0.000308 * T * T;
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

const getPlanetLongitude = (ipli, jd) => {
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
        degreesIntoNakshatra
    };
};

const formatDms = (deg) => {
    const totalSeconds = Math.round(deg * 3600);
    const degrees = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${degrees}°${minutes.toString().padStart(2, "0")}'${seconds.toString().padStart(2, "0")}"`;
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
        balance: { years, months, days }
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
            antya: antya
        });
    }
    return bhavas;
};

exports.getBirthChart = onCall({ cors: true }, (request) => {
    const data = request.data;

    try {
        if (!data.dob || !data.time) throw new Error("Missing birth details");

        const [y, m, d] = data.dob.split("-").map(Number);
        const [hh, mm] = data.time.split(":").map(Number);
        const jsDate = new Date(Date.UTC(y, m - 1, d, hh, mm));
        const jd = toJulianDay(jsDate);
        const ayanamsha = getLahiriAyanamsha(jd);
        const lng = parseFloat(data.lng || 0);

        const lst = greenwichSiderealTime(jd);
        const tropicalAsc = normalizeDegrees(lst + lng);
        const siderealAsc = normalizeDegrees(tropicalAsc - ayanamsha);
        const ascSign = getSign(siderealAsc);

        const charts = { D1: {}, D9: {}, D10: {} };

        const planetConfigs = [
            { name: "Sun", id: SEI_SUN },
            { name: "Moon", id: SEI_MOON },
            { name: "Mercury", id: SEI_MERCURY },
            { name: "Venus", id: SEI_VENUS },
            { name: "Mars", id: SEI_MARS },
            { name: "Jupiter", id: SEI_JUPITER },
            { name: "Saturn", id: SEI_SATURN }
        ];

        const planetaryPositions = [];
        planetConfigs.forEach((p) => {
            const lon = getPlanetLongitude(p.id, jd);
            const sLong = normalizeDegrees(lon - ayanamsha);
            const sign = getSign(sLong);
            const deg = getDegInSign(sLong);
            const house = ((sign - ascSign + 12) % 12) + 1;
            const nakshatra = getNakshatraDetails(sLong);
            const status = getPlanetStatus(p.name, sign);

            charts.D1[p.name] = { sign, house, degrees: deg };
            charts.D9[p.name] = { sign: getNavamshaSign(sign, deg) };
            charts.D10[p.name] = { sign: getDashamshaSign(sign, deg) };

            const formatted = `${p.name} ${SIGN_NAMES[sign - 1]} ${formatDms(deg)} (Nakshatra ${nakshatra.name} Pada ${nakshatra.pada}) ${status}`;
            planetaryPositions.push({
                planet: p.name,
                sign: SIGN_NAMES[sign - 1],
                degrees: formatDms(deg),
                nakshatra: `${nakshatra.name}-${nakshatra.pada}`,
                status,
                formatted
            });
        });

        const rahuTropical = normalizeDegrees(meanNodeLongitude(jd) * (180 / Math.PI));
        const rahuSidereal = normalizeDegrees(rahuTropical - ayanamsha);
        const ketuSidereal = normalizeDegrees(rahuSidereal + 180);

        const rSign = getSign(rahuSidereal);
        const kSign = getSign(ketuSidereal);

        charts.D1.Rahu = { sign: rSign, house: ((rSign - ascSign + 12) % 12) + 1, degrees: getDegInSign(rahuSidereal) };
        charts.D1.Ketu = { sign: kSign, house: ((kSign - ascSign + 12) % 12) + 1, degrees: getDegInSign(ketuSidereal) };

        charts.D9.Rahu = { sign: getNavamshaSign(rSign, getDegInSign(rahuSidereal)) };
        charts.D9.Ketu = { sign: getNavamshaSign(kSign, getDegInSign(ketuSidereal)) };

        const rahuNakshatra = getNakshatraDetails(rahuSidereal);
        const ketuNakshatra = getNakshatraDetails(ketuSidereal);
        planetaryPositions.push({
            planet: "Rahu",
            sign: SIGN_NAMES[rSign - 1],
            degrees: formatDms(getDegInSign(rahuSidereal)),
            nakshatra: `${rahuNakshatra.name}-${rahuNakshatra.pada}`,
            status: "Shadow",
            formatted: `Rahu ${SIGN_NAMES[rSign - 1]} ${formatDms(getDegInSign(rahuSidereal))} (Nakshatra ${rahuNakshatra.name} Pada ${rahuNakshatra.pada}) Shadow`
        });
        planetaryPositions.push({
            planet: "Ketu",
            sign: SIGN_NAMES[kSign - 1],
            degrees: formatDms(getDegInSign(ketuSidereal)),
            nakshatra: `${ketuNakshatra.name}-${ketuNakshatra.pada}`,
            status: "Shadow",
            formatted: `Ketu ${SIGN_NAMES[kSign - 1]} ${formatDms(getDegInSign(ketuSidereal))} (Nakshatra ${ketuNakshatra.name} Pada ${ketuNakshatra.pada}) Shadow`
        });

        const moonLongitude = normalizeDegrees(getPlanetLongitude(SEI_MOON, jd) - ayanamsha);
        const sunLongitude = normalizeDegrees(getPlanetLongitude(SEI_SUN, jd) - ayanamsha);
        const moonNakshatra = getNakshatraDetails(moonLongitude);
        const vimshottariDasha = buildVimshottariDasha(moonLongitude);

        const birthParticulars = {
            vikram_samvat: `Vikram Samvat ${getVikramSamvatYear(jsDate)}`,
            tithi: getTithi(moonLongitude, sunLongitude),
            nakshatra: `${moonNakshatra.name} Nakshatra`
        };

        const avakhada = AVAKHADA_MAP[moonNakshatra.index];

        return {
            status: "success",
            metadata: {
                ascendant_sign: ascSign,
                ascendant_degrees: siderealAsc,
                ayanamsha_used: ayanamsha
            },
            birth_particulars: birthParticulars,
            avakhada_chakra: avakhada,
            planetary_positions: planetaryPositions,
            vimshottari_dasha_at_birth: {
                current: vimshottariDasha.current,
                balance: `${vimshottariDasha.balance.years}y ${vimshottariDasha.balance.months}m ${vimshottariDasha.balance.days}d`
            },
            bhava_sripati: buildSripatiBhava(siderealAsc),
            charts
        };
    } catch (err) {
        console.error("Ephemeris Error:", err);
        throw new HttpsError("internal", `Calculation failed: ${err.message}`);
    }
});
