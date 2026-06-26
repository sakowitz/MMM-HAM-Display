/*
 * Minimal MMM-HAM-Display MagicMirror module entry.
 *
 * Copy this object into the `modules` array in:
 *   MagicMirror/config/config.js
 */

const minimalHamDisplayConfig = {
  module: "MMM-HAM-Display",
  position: "middle_center",
  config: {
    gridLocator: "FN20",
    stationCallsign: "N0CALL"
  }
};

if (typeof module !== "undefined") {
  module.exports = minimalHamDisplayConfig;
}
