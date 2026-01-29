const normalizeDegrees = (degrees) => ((degrees % 360) + 360) % 360;

module.exports = {
  normalizeDegrees,
};
