/**
 * Import function triggers from their respective submodules:
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

// For cost control, you can set the maximum number of containers.
// Fixed spacing: removed internal spaces to satisfy object-curly-spacing
setGlobalOptions({maxInstances: 10});

const requiredFields = ["dob", "time", "lat", "lng", "timezone"];

const buildMockChart = () => ({
  status: "success",
  metadata: {
    ascendant_sign: 6,
    ascendant_degrees: 172.45,
  },
  charts: {
    D1: {
      Sun: {sign: 2, house: 9, isRetrograde: false},
      Moon: {sign: 8, house: 3, isRetrograde: false},
      Mars: {sign: 5, house: 12, isRetrograde: true},
      Mercury: {sign: 3, house: 10, isRetrograde: false},
      Jupiter: {sign: 9, house: 4, isRetrograde: false},
      Venus: {sign: 7, house: 2, isRetrograde: false},
      Saturn: {sign: 11, house: 6, isRetrograde: true},
      Rahu: {sign: 1, house: 7, isRetrograde: true},
      Ketu: {sign: 7, house: 1, isRetrograde: true},
    },
    D9: {
      Sun: {sign: 4, house: 11},
      Moon: {sign: 11, house: 6},
      Mars: {sign: 1, house: 8},
      Mercury: {sign: 9, house: 2},
      Jupiter: {sign: 6, house: 4},
      Venus: {sign: 2, house: 10},
      Saturn: {sign: 12, house: 5},
      Rahu: {sign: 5, house: 1},
      Ketu: {sign: 11, house: 7},
    },
    D10: {
      Sun: {sign: 10, house: 5},
      Moon: {sign: 5, house: 12},
      Mars: {sign: 8, house: 3},
      Mercury: {sign: 6, house: 9},
      Jupiter: {sign: 2, house: 1},
      Venus: {sign: 7, house: 4},
      Saturn: {sign: 9, house: 8},
      Rahu: {sign: 3, house: 6},
      Ketu: {sign: 9, house: 12},
    },
  },
});

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

  return buildMockChart();
});
