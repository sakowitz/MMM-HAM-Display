/*
 * MMM-HAM-Display sample MagicMirror module entry.
 *
 * Copy the object below into the `modules` array in:
 *   MagicMirror/config/config.js
 *
 * Do not edit MMM-HAM-Display.js, node_helper.js, or this sample file for
 * your live settings. Those files are tracked by git and may be replaced by
 * `git pull`.
 */

const hamDisplaySampleConfig = {
  module: "MMM-HAM-Display",
  position: "middle_center",
  config: {
    // Replace this with your Maidenhead grid square.
    gridLocator: "FN20",

    // Optional station label shown on the map and in the header.
    stationCallsign: "N0CALL",

    // Size and timing. Width is the normal center-position sizing knob.
    width: 900,
    mapAspectRatio: 2,
    maxWidthVw: 90,
    updateInterval: 15 * 60 * 1000,
    mapUpdateInterval: 5 * 1000,

    // Optional height-based sizing instead of direct width:
    // height: 450,
    // fitWidthToHeight: true,

    // Display options.
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

    // Satellite tracks and pass list.
    minElevation: 10,
    passLookAheadHours: 12,
    passStepMinutes: 2,
    trackWavelengths: 1,
    trackStepMinutes: 1,
    satellites: [
      { name: "ISS", norad: 25544, color: "#f5e9b8", uplink: "145.825 MHz", downlink: "145.825 MHz", mode: "APRS" },
      { name: "SO-50", norad: 27607, color: "#61d6ff", uplink: "145.850 MHz", downlink: "436.795 MHz", mode: "FM", tone: "67.0 Hz" },
      { name: "RS-44", norad: 44909, color: "#a8ff80", uplink: "145.965-145.995 MHz", downlink: "435.640-435.610 MHz", mode: "Linear" },
      { name: "M2-4", norad: 59051, color: "#7bc7ff", downlink: "137.900 MHz", mode: "LRPT" }
    ]
  }
};

if (typeof module !== "undefined") {
  module.exports = hamDisplaySampleConfig;
}
