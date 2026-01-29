const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const {normalizeDegrees} = require("./math");
const {getSwissPositions} = require("./swissEphemeris");

const TOLERANCES = {
  Sun: 0.000001,
  Moon: 0.000003,
  Mercury: 0.000002,
  Venus: 0.000002,
  Mars: 0.000002,
  Jupiter: 0.000002,
  Saturn: 0.000002,
  Rahu: 0.000005,
  Ketu: 0.000005,
  Ascendant: 0.00001,
};

/**
 * Sample test_cases.json:
 * [
 *   {
 *     "id": "sample-1",
 *     "dob": "1990-01-01",
 *     "time": "12:00",
 *     "lat": 28.6139,
 *     "lng": 77.2090
 *   }
 * ]
 *
 * Sample output snippet:
 * {
 *   "summary": {
 *     "total_cases": 1,
 *     "total_bodies": 10,
 *     "passed": 10,
 *     "failed": 0,
 *     "max_diff": 0.0000007
 *   },
 *   "cases": [
 *     {
 *       "id": "sample-1",
 *       "results": {
 *         "Sun": {"pass": true, "diff": 0.0000002}
 *       }
 *     }
 *   ]
 * }
 */

const angularDiff = (a, b) => {
  const diff = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
  return Math.min(diff, 360 - diff);
};

const ensureFirebase = () => {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
};

const loadReferenceData = async (referenceInput) => {
  if (!referenceInput) return null;
  if (typeof referenceInput !== "string") return referenceInput;

  if (referenceInput.startsWith("gs://")) {
    ensureFirebase();
    const [, bucketName, ...rest] = referenceInput.split("/");
    const filePath = rest.join("/");
    const bucket = admin.storage().bucket(bucketName);
    const [contents] = await bucket.file(filePath).download();
    return JSON.parse(contents.toString("utf-8"));
  }

  if (referenceInput.startsWith("firestore://")) {
    ensureFirebase();
    const docPath = referenceInput.replace("firestore://", "");
    const snapshot = await admin.firestore().doc(docPath).get();
    return snapshot.exists ? snapshot.data() : null;
  }

  const absolutePath = path.isAbsolute(referenceInput) ?
    referenceInput :
    path.join(process.cwd(), referenceInput);
  return JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
};

const computeSwissReference = async (testCase) => {
  const [year, month, day] = testCase.dob.split("-").map(Number);
  const [hour, minute] = testCase.time.split(":").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const lat = Number(testCase.lat || 0);
  const lng = Number(testCase.lng || 0);
  const {ascendant, bodies} = await getSwissPositions({date, lat, lng});
  return {
    Sun: bodies.Sun,
    Moon: bodies.Moon,
    Mercury: bodies.Mercury,
    Venus: bodies.Venus,
    Mars: bodies.Mars,
    Jupiter: bodies.Jupiter,
    Saturn: bodies.Saturn,
    Rahu: bodies.Rahu,
    Ketu: bodies.Ketu,
    Ascendant: ascendant,
  };
};

const generateGoldenReference = async (testCases) => {
  const cases = [];
  for (let i = 0; i < testCases.length; i += 1) {
    const testCase = testCases[i];
    const id = testCase.id || `case-${i + 1}`;
    const bodies = await computeSwissReference(testCase);
    cases.push({id, bodies});
  }
  return {
    generated_at: new Date().toISOString(),
    cases,
  };
};

const validateGoldenReference = async (testCases, referenceInput) => {
  const reference = await loadReferenceData(referenceInput);
  if (!reference || !Array.isArray(reference.cases)) {
    throw new Error("Reference data missing or invalid");
  }

  const referenceMap = new Map(reference.cases.map((entry) => [entry.id, entry]));
  const results = [];
  let totalBodies = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let maxDiff = 0;

  for (let i = 0; i < testCases.length; i += 1) {
    const testCase = testCases[i];
    const id = testCase.id || `case-${i + 1}`;
    const expected = referenceMap.get(id);
    if (!expected) {
      results.push({
        id,
        error: "Missing reference data",
      });
      continue;
    }

    const actualBodies = await computeSwissReference(testCase);
    const bodyResults = {};
    let casePassed = 0;
    let caseFailed = 0;

    Object.keys(TOLERANCES).forEach((body) => {
      const expectedValue = expected.bodies[body];
      const actualValue = actualBodies[body];
      const diff = angularDiff(actualValue, expectedValue);
      const pass = diff <= TOLERANCES[body];
      bodyResults[body] = {
        pass,
        diff,
        expected: expectedValue,
        actual: actualValue,
      };
      totalBodies += 1;
      if (pass) {
        casePassed += 1;
        totalPassed += 1;
      } else {
        caseFailed += 1;
        totalFailed += 1;
      }
      if (diff > maxDiff) maxDiff = diff;
    });

    results.push({
      id,
      passed: casePassed,
      failed: caseFailed,
      results: bodyResults,
    });
  }

  return {
    summary: {
      total_cases: testCases.length,
      total_bodies: totalBodies,
      passed: totalPassed,
      failed: totalFailed,
      max_diff: maxDiff,
    },
    cases: results,
  };
};

module.exports = {
  TOLERANCES,
  angularDiff,
  generateGoldenReference,
  validateGoldenReference,
};
