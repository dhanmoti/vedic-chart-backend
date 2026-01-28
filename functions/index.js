const {setGlobalOptions} = require("firebase-functions");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {
    SwissEphemerisFile,
    SEI_SUN,
    SEI_MOON,
    SEI_MERCURY,
    SEI_VENUS,
    SEI_MARS,
    SEI_JUPITER,
    SEI_SATURN,
    EPHEMERIS_FILES
} = require("./ephemeris/SwissEphemerisFile");
const { compatibility } = require("./astrology/constants");
const {
    normalizeDegrees,
    toJulianDay,
    greenwichSiderealTime
} = require("./astrology/math");
const {
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
    getNodesSidereal
} = require("./astrology/calculations");

setGlobalOptions({maxInstances: 10});

const ephemerisCache = {
  planet: new SwissEphemerisFile(EPHEMERIS_FILES.planet),
  moon: new SwissEphemerisFile(EPHEMERIS_FILES.moon),
};

const { AVAKHADA_MAP } = compatibility;

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
        planetConfigs.forEach((planet) => {
            const lon = getPlanetLongitude(planet.id, jd, ephemerisCache);
            const siderealLongitude = normalizeDegrees(lon - ayanamsha);
            const sign = getSign(siderealLongitude);
            const deg = getDegInSign(siderealLongitude);
            const house = ((sign - ascSign + 12) % 12) + 1;
            const nakshatra = getNakshatraDetails(siderealLongitude);
            const status = getPlanetStatus(planet.name, sign);

            charts.D1[planet.name] = { sign, house, degrees: deg };
            charts.D9[planet.name] = { sign: getNavamshaSign(sign, deg) };
            charts.D10[planet.name] = { sign: getDashamshaSign(sign, deg) };

            const formatted = `${planet.name} ${SIGN_NAMES[sign - 1]} ${formatDms(deg)} (Nakshatra ${nakshatra.name} Pada ${nakshatra.pada}) ${status}`;
            planetaryPositions.push({
                planet: planet.name,
                sign: SIGN_NAMES[sign - 1],
                degrees: formatDms(deg),
                nakshatra: `${nakshatra.name}-${nakshatra.pada}`,
                status,
                formatted
            });
        });

        const { rahuSidereal, ketuSidereal } = getNodesSidereal(jd, ayanamsha);

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

        const moonLongitude = normalizeDegrees(getPlanetLongitude(SEI_MOON, jd, ephemerisCache) - ayanamsha);
        const sunLongitude = normalizeDegrees(getPlanetLongitude(SEI_SUN, jd, ephemerisCache) - ayanamsha);
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
