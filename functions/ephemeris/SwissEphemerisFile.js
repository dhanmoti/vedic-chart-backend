const fs = require("fs");
const path = require("path");

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

const TWOPI = Math.PI * 2;

const EPHEMERIS_PATH = path.join(__dirname, "..", "ephe");
const EPHEMERIS_FILES = {
  planet: path.join(EPHEMERIS_PATH, "sepl_18.se1"),
  moon: path.join(EPHEMERIS_PATH, "semo_18.se1"),
};

/**
 * Evaluate Chebyshev series with recursion.
 * @param {number} x
 * @param {number[]} coef
 * @param {number} ncf
 * @return {number}
 */
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

/**
 * Reader for Swiss Ephemeris binary files.
 */
class SwissEphemerisFile {
  /**
   * @param {string} filePath
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.buffer = fs.readFileSync(filePath);
    this.pos = 0;
    this.planets = new Map();
    this.fendian = SEI_FILE_LITENDIAN;
    this.freord = 0;
    this.readConst();
  }

  /**
   * @return {string}
   */
  readLine() {
    const idx = this.buffer.indexOf("\r\n", this.pos, "binary");
    if (idx === -1) {
      throw new Error(`Invalid ephemeris header: ${this.filePath}`);
    }
    const line = this.buffer.slice(this.pos, idx).toString("latin1");
    this.pos = idx + 2;
    return line;
  }

  /**
   * @param {number} pos
   * @return {void}
   */
  seek(pos) {
    this.pos = pos;
  }

  /**
   * @param {number} size
   * @param {number} count
   * @return {Buffer}
   */
  read(size, count) {
    const bytes = size * count;
    const chunk = this.buffer.slice(this.pos, this.pos + bytes);
    if (chunk.length !== bytes) {
      throw new Error(`Unexpected EOF in ${this.filePath}`);
    }
    this.pos += bytes;
    return chunk;
  }

  /**
   * @param {number} size
   * @param {number} count
   * @param {number} corrsize
   * @param {number} fpos
   * @return {Buffer}
   */
  doFread(size, count, corrsize, fpos) {
    if (fpos >= 0) this.seek(fpos);
    const raw = this.read(size, count);
    if (!this.freord && size === corrsize) return raw;
    const out = Buffer.alloc(count * corrsize);
    for (let i = 0; i < count; i += 1) {
      for (let j = size - 1; j >= 0; j -= 1) {
        let k = this.freord ? (size - j - 1) : j;
        if (size !== corrsize) {
          if (
            (this.fendian === SEI_FILE_BIGENDIAN && !this.freord) ||
            (this.fendian === SEI_FILE_LITENDIAN && this.freord)
          ) {
            k += corrsize - size;
          }
        }
        out[i * corrsize + k] = raw[i * size + j];
      }
    }
    return out;
  }

  /**
   * @param {number} size
   * @param {number} fpos
   * @return {number}
   */
  readInt(size, fpos) {
    const raw = this.doFread(size, 1, 4, fpos);
    return raw.readInt32LE(0);
  }

  /**
   * @param {number} fpos
   * @return {number}
   */
  readShort(fpos) {
    const raw = this.doFread(2, 1, 2, fpos);
    return raw.readInt16LE(0);
  }

  /**
   * @param {number} fpos
   * @return {number}
   */
  readDouble(fpos) {
    const raw = this.doFread(8, 1, 8, fpos);
    return raw.readDoubleLE(0);
  }

  /**
   * @param {number} count
   * @return {number[]}
   */
  readDoubleArray(count) {
    const raw = this.doFread(8, count, 8, SEI_CURR_FPOS);
    const values = [];
    for (let i = 0; i < count; i += 1) {
      values.push(raw.readDoubleLE(i * 8));
    }
    return values;
  }

  /**
   * @return {void}
   */
  readConst() {
    this.readLine();
    this.readLine();
    this.readLine();

    const testendian = this.buffer.readInt32LE(this.pos);
    this.pos += 4;
    if (testendian !== SEI_FILE_TEST_ENDIAN) {
      this.freord = SEI_FILE_REORD;
      const swapped = Buffer.from(
          this.buffer.slice(this.pos - 4, this.pos),
      )
          .reverse()
          .readInt32LE(0);
      if (swapped !== SEI_FILE_TEST_ENDIAN) {
        throw new Error(`Invalid endianness in ${this.filePath}`);
      }
    }
    const testBytes = Buffer.alloc(4);
    testBytes.writeInt32LE(testendian, 0);
    const c2 = Math.floor(SEI_FILE_TEST_ENDIAN / 16777216);
    this.fendian = testBytes[0] === c2 ?
      SEI_FILE_BIGENDIAN :
      SEI_FILE_LITENDIAN;

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
        refep: null,
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

  /**
   * @param {Object} planet
   * @return {void}
   */
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
    const x = Array.from({length: nco}, (_, i) => [
      planet.segp[i],
      planet.segp[i + nco],
      planet.segp[i + 2 * nco],
    ]);
    if (planet.iflg & SEI_FLG_ELLIPSE && planet.refep) {
      const omtild = planet.peri + tdiff * planet.dperi;
      const omtildMod = omtild - Math.floor(omtild / TWOPI) * TWOPI;
      const com = Math.cos(omtildMod);
      const som = Math.sin(omtildMod);
      for (let i = 0; i < nco; i += 1) {
        x[i][0] = planet.segp[i] +
          com * planet.refep[i] -
          som * planet.refep[i + nco];
        x[i][1] = planet.segp[i + nco] +
          com * planet.refep[i + nco] +
          som * planet.refep[i];
      }
    }
    const cosih2 = 1.0 / (1.0 + qav * qav + pav * pav);
    const uiz = [
      2.0 * pav * cosih2,
      -2.0 * qav * cosih2,
      (1.0 - qav * qav - pav * pav) * cosih2,
    ];
    const uiy = [-uiz[1], uiz[0], 0.0];
    const uizLen = Math.hypot(uiz[0], uiz[1], uiz[2]);
    const uiyLen = Math.hypot(uiy[0], uiy[1], uiy[2]);
    const uizn = uiz.map((v) => v / uizLen);
    const uiyn = uiy.map((v) => v / uiyLen);
    const uix = [
      uiyn[1] * uizn[2] - uiyn[2] * uizn[1],
      uiyn[2] * uizn[0] - uiyn[0] * uizn[2],
      uiyn[0] * uizn[1] - uiyn[1] * uizn[0],
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

  /**
   * @param {number} ipli
   * @param {number} tjd
   * @return {void}
   */
  readSegment(ipli, tjd) {
    const planet = this.planets.get(ipli);
    if (!planet) {
      throw new Error(
          `Missing ephemeris body ${ipli} in ${this.filePath}`,
      );
    }
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
          extra[1] % 16,
        ];
      } else {
        nsizes = 4;
        nsize = [
          Math.floor(c[0] / 16),
          c[0] % 16,
          Math.floor(c[1] / 16),
          c[1] % 16,
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
              planet.segp[idbl] = -(
                ((val + 1) / 2) / 1e9 * planet.rmax / 2
              );
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
                planet.segp[idbl] = -(
                  ((value + o) / o / 2) * planet.rmax / 2 / 1e9
                );
              } else {
                planet.segp[idbl] = (
                  (value / o / 2) * planet.rmax / 2 / 1e9
                );
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
                planet.segp[idbl] = -(
                  ((value + o) / o / 2) * planet.rmax / 2 / 1e9
                );
              } else {
                planet.segp[idbl] = (
                  (value / o / 2) * planet.rmax / 2 / 1e9
                );
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

  /**
   * @param {number} ipli
   * @param {number} tjd
   * @return {number[]}
   */
  evaluate(ipli, tjd) {
    const planet = this.planets.get(ipli);
    if (!planet) {
      throw new Error(
          `Missing ephemeris body ${ipli} in ${this.filePath}`,
      );
    }
    if (!planet.segp || tjd < planet.tseg0 || tjd > planet.tseg1) {
      this.readSegment(ipli, tjd);
    }
    const t = ((tjd - planet.tseg0) / planet.dseg) * 2 - 1;
    const nco = planet.ncoe;
    const values = [];
    for (let i = 0; i < 3; i += 1) {
      const offset = i * nco;
      values.push(
          echeb(t, planet.segp.slice(offset, offset + nco), planet.neval),
      );
    }
    return values;
  }

  /**
   * @param {number} ipli
   * @return {number}
   */
  getIfFlags(ipli) {
    const planet = this.planets.get(ipli);
    return planet ? planet.iflg : 0;
  }
}

module.exports = {
  SwissEphemerisFile,
  SEI_FILE_TEST_ENDIAN,
  SEI_CURR_FPOS,
  SEI_FILE_BIGENDIAN,
  SEI_FILE_LITENDIAN,
  SEI_FILE_REORD,
  SEI_FLG_HELIO,
  SEI_FLG_ROTATE,
  SEI_FLG_ELLIPSE,
  SEI_SUN,
  SEI_MOON,
  SEI_MERCURY,
  SEI_VENUS,
  SEI_MARS,
  SEI_JUPITER,
  SEI_SATURN,
  SEI_URANUS,
  SEI_NEPTUNE,
  SEI_PLUTO,
  EPHEMERIS_PATH,
  EPHEMERIS_FILES,
};
