const {logger} = require("firebase-functions");
const {onRequest} = require("firebase-functions/v2/https");

exports.helloVedic = onRequest((request, response) => {
  logger.info("helloVedic function invoked", {structuredData: true});
  response.json({
    message: "Namaste from Firebase Functions!",
  });
});
