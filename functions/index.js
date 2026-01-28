const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const Astronomy = require("astronomy-engine");

setGlobalOptions({ maxInstances: 10 });

/** VEDIC LOGIC HELPERS */
const normalizeDegrees = (d) => ((d % 360) + 360) % 360;
const getSign = (d) => Math.floor(normalizeDegrees(d) / 30) + 1;
const getDegInSign = (d) => normalizeDegrees(d) % 30;

const getAyanamsha = (year) => {
    return 23.85 + (year - 2000) * (50.27 / 3600);
};

// Standard Mean Node formula (Meeus/Moshier) - Very stable
const getMeanRahu = (astroTime) => {
    const T = astroTime.tt / 36525.0; // Centuries from J2000
    // Formula for Mean Ascending Node of the Moon
    let omega = 125.0445222 - (1934.1362608 * T) + (0.0020708 * T * T) + (T * T * T / 450000);
    return normalizeDegrees(omega);
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

exports.getBirthChart = onCall({ cors: true }, (request) => {
    const data = request.data;
    
    try {
        if (!data.dob || !data.time) throw new Error("Missing birth details");
        
        const [y, m, d] = data.dob.split("-").map(Number);
        const [hh, mm] = data.time.split(":").map(Number);
        const jsDate = new Date(Date.UTC(y, m - 1, d, hh, mm));

        const astroTime = Astronomy.MakeTime(jsDate);
        const ayanamsha = getAyanamsha(y);
        const lng = parseFloat(data.lng || 0);

        // 1. Calculate Sidereal Ascendant
        const lst = Astronomy.SiderealTime(astroTime);
        const tropicalAsc = normalizeDegrees(lst * 15 + lng);
        const siderealAsc = normalizeDegrees(tropicalAsc - ayanamsha);
        const ascSign = getSign(siderealAsc);

        const charts = { D1: {}, D9: {}, D10: {} };

        // 2. Main Planets
        const planetConfigs = [
            { name: "Sun", body: Astronomy.Body.Sun },
            { name: "Moon", body: Astronomy.Body.Moon },
            { name: "Mercury", body: Astronomy.Body.Mercury },
            { name: "Venus", body: Astronomy.Body.Venus },
            { name: "Mars", body: Astronomy.Body.Mars },
            { name: "Jupiter", body: Astronomy.Body.Jupiter },
            { name: "Saturn", body: Astronomy.Body.Saturn }
        ];

        planetConfigs.forEach(p => {
            let lon;
            if (p.name === "Sun") {
                lon = Astronomy.SunPosition(astroTime).elon;
            } else {
                lon = Astronomy.EclipticLongitude(p.body, astroTime);
            }

            const sLong = normalizeDegrees(lon - ayanamsha);
            const sign = getSign(sLong);
            const deg = getDegInSign(sLong);
            const house = ((sign - ascSign + 12) % 12) + 1;

            charts.D1[p.name] = { sign, house, degrees: deg };
            charts.D9[p.name] = { sign: getNavamshaSign(sign, deg) };
            charts.D10[p.name] = { sign: getDashamshaSign(sign, deg) };
        });

        // 3. Rahu & Ketu (Calculated via Mean Node Formula)
        const rahuTropical = getMeanRahu(astroTime);
        const rahuSidereal = normalizeDegrees(rahuTropical - ayanamsha);
        const ketuSidereal = normalizeDegrees(rahuSidereal + 180);

        const rSign = getSign(rahuSidereal);
        const kSign = getSign(ketuSidereal);

        charts.D1.Rahu = { sign: rSign, house: ((rSign - ascSign + 12) % 12) + 1, degrees: getDegInSign(rahuSidereal) };
        charts.D1.Ketu = { sign: kSign, house: ((kSign - ascSign + 12) % 12) + 1, degrees: getDegInSign(ketuSidereal) };
        
        charts.D9.Rahu = { sign: getNavamshaSign(rSign, getDegInSign(rahuSidereal)) };
        charts.D9.Ketu = { sign: getNavamshaSign(kSign, getDegInSign(ketuSidereal)) };

        return {
            status: "success",
            metadata: {
                ascendant_sign: ascSign,
                ascendant_degrees: siderealAsc,
                ayanamsha_used: ayanamsha
            },
            charts
        };

    } catch (err) {
        console.error("Astro Engine Error:", err);
        throw new HttpsError("internal", `Calculation failed: ${err.message}`);
    }
});