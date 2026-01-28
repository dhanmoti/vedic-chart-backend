const fs = require("fs");
const path = require("path");
const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

setGlobalOptions({ maxInstances: 10 });

const SEI_FILE_TEST_ENDIAN = 0x616263;
const SEI_CURR_FPOS = -1;
const SEI_FILE_BIGENDIAN = 0;
const SEI_FILE_LITENDIAN = 1;
const SEI_FILE_REORD = 2;

const SEI_FLG_HELIO = 1;
const SEI_FLG_ROTATE = 2;
const SEI_FLG_ELLIPSE = 4;

const SEI_SUN = 0;
const SEI_MOON = 1;
const SEI_MERCURY = 2;
const SEI_VENUS = 3;
const SEI_MARS = 4;
const SEI_JUPITER = 5;
const SEI_SATURN = 6;
const SEI_URANUS = 7;
const SEI_NEPTUNE = 8;
const SEI_PLUTO = 9;

const J2000 = 2451545.0;
const TWOPI = Math.PI * 2;

const EPHEMERIS_PATH = path.join(__dirname, "ephe");
const EPHEMERIS_FILES = {
    planet: path.join(EPHEMERIS_PATH, "sepl_18.se1"),
    moon: path.join(EPHEMERIS_PATH, "semo_18.se1")
};

class SwissEphemerisFile {
    constructor(filePath) {
        this.filePath = filePath;
        this.buffer = fs.readFileSync(filePath);
        this.pos = 0;
        this.planets = new Map();
        this.fendian = SEI_FILE_LITENDIAN;
        this.freord = 0;
        this.readConst();
    }

    readLine() {
        const idx = this.buffer.indexOf("\r\n", this.pos, "binary");
        if (idx === -1) throw new Error(`Invalid ephemeris header: ${this.filePath}`);
        const line = this.buffer.slice(this.pos, idx).toString("latin1");
        this.pos = idx + 2;
        return line;
    }

    seek(pos) {
        this.pos = pos;
    }

    read(size, count) {
        const bytes = size * count;
        const chunk = this.buffer.slice(this.pos, this.pos + bytes);
        if (chunk.length !== bytes) throw new Error(`Unexpected EOF in ${this.filePath}`);
        this.pos += bytes;
        return chunk;
    }

    doFread(size, count, corrsize, fpos) {
        if (fpos >= 0) this.seek(fpos);
        const raw = this.read(size, count);
        if (!this.freord && size === corrsize) return raw;
        const out = Buffer.alloc(count * corrsize);
        for (let i = 0; i < count; i += 1) {
            for (let j = size - 1; j >= 0; j -= 1) {
                let k = this.freord ? (size - j - 1) : j;
                if (size !== corrsize) {
                    if ((this.fendian === SEI_FILE_BIGENDIAN && !this.freord)
                        || (this.fendian === SEI_FILE_LITENDIAN && this.freord)) {
                        k += corrsize - size;
                    }
                }
                out[i * corrsize + k] = raw[i * size + j];
            }
        }
        return out;
    }

    readInt(size, fpos) {
        const raw = this.doFread(size, 1, 4, fpos);
        return raw.readInt32LE(0);
    }

    readShort(fpos) {
        const raw = this.doFread(2, 1, 2, fpos);
        return raw.readInt16LE(0);
    }

    readDouble(fpos) {
        const raw = this.doFread(8, 1, 8, fpos);
        return raw.readDoubleLE(0);
    }

    readDoubleArray(count) {
        const raw = this.doFread(8, count, 8, SEI_CURR_FPOS);
        const values = [];
        for (let i = 0; i < count; i += 1) {
            values.push(raw.readDoubleLE(i * 8));
        }
        return values;
    }

    readConst() {
        this.readLine();
        this.readLine();
        this.readLine();

        const testendian = this.buffer.readInt32LE(this.pos);
        this.pos += 4;
        if (testendian !== SEI_FILE_TEST_ENDIAN) {
            this.freord = SEI_FILE_REORD;
            const swapped = Buffer.from(this.buffer.slice(this.pos - 4, this.pos)).reverse().readInt32LE(0);
            if (swapped !== SEI_FILE_TEST_ENDIAN) {
                throw new Error(`Invalid endianness in ${this.filePath}`);
            }
        }
        const testBytes = Buffer.alloc(4);
        testBytes.writeInt32LE(testendian, 0);
        const c2 = Math.floor(SEI_FILE_TEST_ENDIAN / 16777216);
        this.fendian = testBytes[0] === c2 ? SEI_FILE_BIGENDIAN : SEI_FILE_LITENDIAN;

        this.readInt(4, SEI_CURR_FPOS); // file length
        this.readInt(4, this.pos); // sweph_denum
        this.fileStart = this.readDouble(SEI_CURR_FPOS);
        this.fileEnd = this.readDouble(SEI_CURR_FPOS);

        let nplan = this.readShort(SEI_CURR_FPOS);
        let nbytesIpl = 2;
        if (nplan > 256) {
            nbytesIpl = 4;
            nplan %= 256;
        }
        const iplRaw = this.doFread(nbytesIpl, nplan, 4, SEI_CURR_FPOS);
        const ipl = [];
        for (let i = 0; i < nplan; i += 1) {
            ipl.push(iplRaw.readInt32LE(i * 4));
        }

        this.readInt(4, SEI_CURR_FPOS); // CRC
        this.readDoubleArray(5); // constants

        ipl.forEach((ipli) => {
            const lndx0 = this.readInt(4, SEI_CURR_FPOS);
            const iflg = this.readInt(1, SEI_CURR_FPOS);
            const ncoe = this.readInt(1, SEI_CURR_FPOS);
            const rmax = this.readInt(4, SEI_CURR_FPOS) / 1000.0;
            const constants = this.readDoubleArray(10);
            const planet = {
                ipli,
                lndx0,
                iflg,
                ncoe,
                rmax,
                tfstart: constants[0],
                tfend: constants[1],
                dseg: constants[2],
                telem: constants[3],
                prot: constants[4],
                dprot: constants[5],
                qrot: constants[6],
                dqrot: constants[7],
                peri: constants[8],
                dperi: constants[9],
                segp: null,
                tseg0: 0,
                tseg1: 0,
                neval: 0,
                refep: null
            };
            if (iflg & SEI_FLG_ELLIPSE) {
                const refRaw = this.doFread(8, 2 * ncoe, 8, SEI_CURR_FPOS);
                const refep = [];
                for (let i = 0; i < 2 * ncoe; i += 1) {
                    refep.push(refRaw.readDoubleLE(i * 8));
                }
                planet.refep = refep;
            }
            this.planets.set(ipli, planet);
        });
    }

    rotBack(planet) {
        const nco = planet.ncoe;
        const t = planet.tseg0 + planet.dseg / 2;
        const tdiff = (t - planet.telem) / 365250.0;
        let qav = 0;
        let pav = 0;
        if (planet.ipli === SEI_MOON) {
            let dn = planet.prot + tdiff * planet.dprot;
            dn -= Math.floor(dn / TWOPI) * TWOPI;
            qav = (planet.qrot + tdiff * planet.dqrot) * Math.cos(dn);
            pav = (planet.qrot + tdiff * planet.dqrot) * Math.sin(dn);
        } else {
            qav = planet.qrot + tdiff * planet.dqrot;
            pav = planet.prot + tdiff * planet.dprot;
        }
        const x = Array.from({ length: nco }, (_, i) => [
            planet.segp[i],
            planet.segp[i + nco],
            planet.segp[i + 2 * nco]
        ]);
        if (planet.iflg & SEI_FLG_ELLIPSE && planet.refep) {
            const omtild = planet.peri + tdiff * planet.dperi;
            const omtildMod = omtild - Math.floor(omtild / TWOPI) * TWOPI;
            const com = Math.cos(omtildMod);
            const som = Math.sin(omtildMod);
            for (let i = 0; i < nco; i += 1) {
                x[i][0] = planet.segp[i] + com * planet.refep[i] - som * planet.refep[i + nco];
                x[i][1] = planet.segp[i + nco] + com * planet.refep[i + nco] + som * planet.refep[i];
            }
        }
        const cosih2 = 1.0 / (1.0 + qav * qav + pav * pav);
        const uiz = [2.0 * pav * cosih2, -2.0 * qav * cosih2, (1.0 - qav * qav - pav * pav) * cosih2];
        const uiy = [-uiz[1], uiz[0], 0.0];
        const uizLen = Math.hypot(uiz[0], uiz[1], uiz[2]);
        const uiyLen = Math.hypot(uiy[0], uiy[1], uiy[2]);
        const uizn = uiz.map((v) => v / uizLen);
        const uiyn = uiy.map((v) => v / uiyLen);
        const uix = [
            uiyn[1] * uizn[2] - uiyn[2] * uizn[1],
            uiyn[2] * uizn[0] - uiyn[0] * uizn[2],
            uiyn[0] * uizn[1] - uiyn[1] * uizn[0]
        ];
        const seps2000 = 0.39777715572793088;
        const ceps2000 = 0.91748206215761929;
        for (let i = 0; i < nco; i += 1) {
            const xrot = uix[0] * x[i][0] + uiyn[0] * x[i][1] + uizn[0] * x[i][2];
            const yrot = uix[1] * x[i][0] + uiyn[1] * x[i][1] + uizn[1] * x[i][2];
            const zrot = uix[2] * x[i][0] + uiyn[2] * x[i][1] + uizn[2] * x[i][2];
            const yrot2 = ceps2000 * yrot + seps2000 * zrot;
            const zrot2 = -seps2000 * yrot + ceps2000 * zrot;
            planet.segp[i] = xrot;
            planet.segp[i + nco] = yrot2;
            planet.segp[i + 2 * nco] = zrot2;
        }
    }

    readSegment(ipli, tjd) {
        const planet = this.planets.get(ipli);
        if (!planet) throw new Error(`Missing ephemeris body ${ipli} in ${this.filePath}`);
        const iseg = Math.floor((tjd - planet.tfstart) / planet.dseg);
        planet.tseg0 = planet.tfstart + iseg * planet.dseg;
        planet.tseg1 = planet.tseg0 + planet.dseg;
        const fpos = this.readInt(3, planet.lndx0 + iseg * 3);
        this.seek(fpos);
        const nco = planet.ncoe;
        planet.segp = Array(nco * 3).fill(0);
        for (let icoord = 0; icoord < 3; icoord += 1) {
            let idbl = icoord * nco;
            const c = Array.from(this.doFread(1, 2, 1, SEI_CURR_FPOS));
            let nsizes;
            let nsize;
            if (c[0] & 128) {
                const extra = Array.from(this.doFread(1, 2, 1, SEI_CURR_FPOS));
                nsizes = 6;
                nsize = [
                    Math.floor(c[1] / 16),
                    c[1] % 16,
                    Math.floor(extra[0] / 16),
                    extra[0] % 16,
                    Math.floor(extra[1] / 16),
                    extra[1] % 16
                ];
            } else {
                nsizes = 4;
                nsize = [
                    Math.floor(c[0] / 16),
                    c[0] % 16,
                    Math.floor(c[1] / 16),
                    c[1] % 16
                ];
            }
            for (let i = 0; i < nsizes; i += 1) {
                if (!nsize[i]) continue;
                if (i < 4) {
                    const j = 4 - i;
                    const k = nsize[i];
                    const longs = this.doFread(j, k, 4, SEI_CURR_FPOS);
                    for (let m = 0; m < k; m += 1) {
                        const val = longs.readUInt32LE(m * 4);
                        if (val & 1) {
                            planet.segp[idbl] = -(((val + 1) / 2) / 1e9 * planet.rmax / 2);
                        } else {
                            planet.segp[idbl] = (val / 2) / 1e9 * planet.rmax / 2;
                        }
                        idbl += 1;
                    }
                } else if (i === 4) {
                    const k = Math.floor((nsize[i] + 1) / 2);
                    const longs = this.doFread(1, k, 4, SEI_CURR_FPOS);
                    let j = 0;
                    for (let m = 0; m < k && j < nsize[i]; m += 1) {
                        let value = longs.readUInt32LE(m * 4);
                        let o = 16;
                        for (let n = 0; n < 2 && j < nsize[i]; n += 1, j += 1, o /= 16) {
                            if (value & o) {
                                planet.segp[idbl] = -(((value + o) / o / 2) * planet.rmax / 2 / 1e9);
                            } else {
                                planet.segp[idbl] = ((value / o / 2) * planet.rmax / 2 / 1e9);
                            }
                            idbl += 1;
                            value %= o;
                        }
                    }
                } else if (i === 5) {
                    const k = Math.floor((nsize[i] + 3) / 4);
                    const longs = this.doFread(1, k, 4, SEI_CURR_FPOS);
                    let j = 0;
                    for (let m = 0; m < k && j < nsize[i]; m += 1) {
                        let value = longs.readUInt32LE(m * 4);
                        let o = 64;
                        for (let n = 0; n < 4 && j < nsize[i]; n += 1, j += 1, o /= 4) {
                            if (value & o) {
                                planet.segp[idbl] = -(((value + o) / o / 2) * planet.rmax / 2 / 1e9);
                            } else {
                                planet.segp[idbl] = ((value / o / 2) * planet.rmax / 2 / 1e9);
                            }
                            idbl += 1;
                            value %= o;
                        }
                    }
                }
            }
        }
        planet.neval = planet.ncoe;
        if (planet.iflg & SEI_FLG_ROTATE) {
            this.rotBack(planet);
        }
    }

    evaluate(ipli, tjd) {
        const planet = this.planets.get(ipli);
        if (!planet) throw new Error(`Missing ephemeris body ${ipli} in ${this.filePath}`);
        if (!planet.segp || tjd < planet.tseg0 || tjd > planet.tseg1) {
            this.readSegment(ipli, tjd);
        }
        const t = ((tjd - planet.tseg0) / planet.dseg) * 2 - 1;
        const nco = planet.ncoe;
        const values = [];
        for (let i = 0; i < 3; i += 1) {
            const offset = i * nco;
            values.push(echeb(t, planet.segp.slice(offset, offset + nco), planet.neval));
        }
        return values;
    }

    getIfFlags(ipli) {
        const planet = this.planets.get(ipli);
        return planet ? planet.iflg : 0;
    }
}

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

const echeb = (x, coef, ncf) => {
    let br = 0;
    let brp2 = 0;
    let brpp = 0;
    const x2 = x * 2;
    for (let j = ncf - 1; j >= 0; j -= 1) {
        brp2 = brpp;
        brpp = br;
        br = x2 * brpp - brp2 + coef[j];
    }
    return (br - brp2) * 0.5;
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
