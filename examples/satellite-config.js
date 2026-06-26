/*
 * MMM-HAM-Display example with amateur satellite tracking enabled.
 *
 * Copy this object into the `modules` array in:
 *   MagicMirror/config/config.js
 */

const satelliteHamDisplayConfig = {
  module: "MMM-HAM-Display",
  position: "middle_center",
  config: {
    gridLocator: "FN20",
    stationCallsign: "N0CALL",

    width: 900,
    maxWidthVw: 90,
    mapAspectRatio: 2,
    updateInterval: 15 * 60 * 1000,
    mapUpdateInterval: 5 * 1000,

    showHeader: true,
    showConditionStrip: true,
    showMap: true,
    showGreyline: true,
    showGraticule: true,
    showBandPanel: true,
    showSatellitePanel: true,
    showSatelliteTracks: true,
    showSatelliteFootprints: true,
    showSatelliteLabels: true,
    showPassFrequencies: true,

    maxPasses: 3,
    minElevation: 10,
    passLookAheadHours: 12,
    passStepMinutes: 2,
    trackWavelengths: 1,
    trackStepMinutes: 1,

    satellites: [
      { name: "ISS", norad: 25544, color: "#f5e9b8", uplink: "145.825 MHz", downlink: "145.825 MHz", mode: "APRS" },
      { name: "SO-50", norad: 27607, color: "#61d6ff", uplink: "145.850 MHz", downlink: "436.795 MHz", mode: "FM", tone: "67.0 Hz" },
      { name: "RS-44", norad: 44909, color: "#a8ff80", uplink: "145.965-145.995 MHz", downlink: "435.640-435.610 MHz", mode: "Linear" }
    ]
  }
};

if (typeof module !== "undefined") {
  module.exports = satelliteHamDisplayConfig;
}
