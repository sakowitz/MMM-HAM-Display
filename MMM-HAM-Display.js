/* global Module */

const HAMDisplayNotifications = {
  CONFIG: "MMM_HAM_DISPLAY_CONFIG",
  REQUEST: "MMM_HAM_DISPLAY_REQUEST",
  UPDATE: "MMM_HAM_DISPLAY_UPDATE",
  ERROR: "MMM_HAM_DISPLAY_ERROR"
};

const HAMDisplaySvgNs = "http://www.w3.org/2000/svg";
const HAMDisplayEarthRadiusKm = 6371;
const HAMDisplayEarthMu = 398600.4418;
const HAMDisplayTau = Math.PI * 2;

Module.register("MMM-HAM-Display", {
  requiresVersion: "2.1.0",

  defaults: {
    title: "HAM Conditions",
    gridLocator: "",
    stationCallsign: "",
    width: 900,
    height: 450,
    mapAspectRatio: 2,
    fitWidthToHeight: false,
    maxWidthVw: 90,
    landGeoJsonPath: "assets/ne_110m_land.geojson",
    updateInterval: 15 * 60 * 1000,
    mapUpdateInterval: 5 * 1000,
    animationSpeed: 0,
    timeoutMs: 9000,
    solarCacheMs: 10 * 60 * 1000,
    tleCacheMs: 6 * 60 * 60 * 1000,
    hamqslSolarUrl: "https://www.hamqsl.com/solarxml.php",
    showGreyline: true,
    showGraticule: true,
    showSatelliteTracks: true,
    showSatelliteFootprints: true,
    showSatelliteLabels: true,
    showHeader: true,
    showUtcTime: true,
    showConditionStrip: true,
    showMap: true,
    showBandPanel: true,
    showSatellitePanel: true,
    showPassFrequencies: true,
    maxPasses: 3,
    trackWavelengths: 1,
    trackMinutesBefore: 10,
    trackMinutesAfter: 30,
    trackStepMinutes: 1,
    passLookAheadHours: 12,
    passStepMinutes: 2,
    minElevation: 10,
    satellites: [],
    colors: {
      background: "#030608",
      ocean: "#071722",
      land: "#294336",
      landEdge: "rgba(205, 240, 210, 0.58)",
      graticule: "rgba(174, 218, 205, 0.16)",
      night: "rgba(0, 0, 0, 0.42)",
      greyline: "rgba(255, 208, 116, 0.18)",
      station: "#ffe48a",
      text: "#edf6ef",
      muted: "#97a7a0",
      accent: "#d8f8a6",
      warning: "#ffc26b",
      poor: "#d67870",
      fair: "#ffc66d",
      good: "#a8f08a"
    }
  },

  start: function () {
    this.instanceId = this.identifier || `${this.name}-${Date.now()}`;
    this.solar = {};
    this.satelliteFeed = { items: [] };
    this.status = "Loading radio data";
    this.error = null;
    this.lastUpdated = null;
    this.station = this.gridToLatLon(this.config.gridLocator);
    this.landFeatures = [];
    this.landLoadError = null;
    this.requestTimer = null;
    this.clockTimer = null;

    this.loadLandData();
    this.sendConfig();
    this.scheduleRequest(150);
    this.clockTimer = setInterval(() => this.updateDom(this.domAnimationSpeed()), this.mapUpdateIntervalMs());
  },

  getStyles: function () {
    return [this.file("MMM-HAM-Display.css")];
  },

  loadLandData: function () {
    const path = this.config.landGeoJsonPath || this.defaults.landGeoJsonPath;

    if (!path) {
      this.landFeatures = [];
      return;
    }

    fetch(this.file(path))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Map asset unavailable (${response.status})`);
        }
        return response.json();
      })
      .then((geojson) => {
        this.landFeatures = Array.isArray(geojson.features) ? geojson.features : [];
        this.landLoadError = null;
        this.updateDom(this.domAnimationSpeed());
      })
      .catch((error) => {
        this.landFeatures = [];
        this.landLoadError = error.message;
        this.updateDom(this.domAnimationSpeed());
      });
  },

  getHeader: function () {
    return "";
  },

  suspend: function () {
    clearTimeout(this.requestTimer);
    clearInterval(this.clockTimer);
    this.requestTimer = null;
    this.clockTimer = null;
  },

  resume: function () {
    this.station = this.gridToLatLon(this.config.gridLocator);
    if (!this.landFeatures || this.landFeatures.length === 0) {
      this.loadLandData();
    }
    this.sendConfig();
    this.scheduleRequest(150);
    if (!this.clockTimer) {
      this.clockTimer = setInterval(() => this.updateDom(this.domAnimationSpeed()), this.mapUpdateIntervalMs());
    }
  },

  sendConfig: function () {
    this.sendSocketNotification(HAMDisplayNotifications.CONFIG, {
      instanceId: this.instanceId,
      config: this.config
    });
  },

  scheduleRequest: function (delay) {
    clearTimeout(this.requestTimer);
    this.requestTimer = setTimeout(() => {
      this.sendSocketNotification(HAMDisplayNotifications.REQUEST, {
        instanceId: this.instanceId
      });
    }, typeof delay === "number" ? delay : this.updateIntervalMs());
  },

  socketNotificationReceived: function (notification, payload) {
    if (!payload || payload.instanceId !== this.instanceId) {
      return;
    }

    if (notification === HAMDisplayNotifications.UPDATE) {
      this.error = null;
      this.solar = payload.solar || {};
      this.satelliteFeed = payload.satellites || { items: [] };
      this.lastUpdated = new Date(payload.generatedAt || Date.now());
      this.status = this.statusForPayload(payload);
      this.updateDom(this.domAnimationSpeed());
      this.scheduleRequest();
      return;
    }

    if (notification === HAMDisplayNotifications.ERROR) {
      this.error = payload.message || "Unable to load HAM display data";
      this.status = "Data unavailable";
      this.updateDom(this.domAnimationSpeed());
      this.scheduleRequest(Math.max(this.updateIntervalMs(), 5 * 60 * 1000));
    }
  },

  statusForPayload: function (payload) {
    const solarError = payload.solar && payload.solar.error;
    const satellites = payload.satellites && Array.isArray(payload.satellites.items) ? payload.satellites.items : [];
    const goodSatellites = satellites.filter((item) => item.tle && !item.error).length;

    if (solarError && goodSatellites === 0) {
      return "Using local calculations";
    }

    if (solarError) {
      return "Solar feed unavailable";
    }

    return "Live radio conditions";
  },

  updateIntervalMs: function () {
    const interval = Number(this.config.updateInterval);
    return Number.isFinite(interval) ? Math.max(interval, 60000) : this.defaults.updateInterval;
  },

  mapUpdateIntervalMs: function () {
    const interval = Number(this.config.mapUpdateInterval);
    return Number.isFinite(interval) ? Math.max(interval, 1000) : this.defaults.mapUpdateInterval;
  },

  domAnimationSpeed: function () {
    const speed = Number(this.config.animationSpeed);
    return Number.isFinite(speed) ? speed : 0;
  },

  maxPasses: function () {
    const value = Number(this.config.maxPasses);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : this.defaults.maxPasses;
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-ham-display";
    this.applyTheme(wrapper);

    if (!this.station) {
      wrapper.appendChild(this.buildMessage("Set gridLocator in MagicMirror/config/config.js."));
      return wrapper;
    }

    if (this.config.showHeader) {
      wrapper.appendChild(this.buildHeader());
    }

    if (this.config.showConditionStrip) {
      wrapper.appendChild(this.buildConditionStrip());
    }

    if (this.config.showMap) {
      wrapper.appendChild(this.buildMap());
    }

    const lowerPanels = this.buildLowerPanels();
    if (lowerPanels) {
      wrapper.appendChild(lowerPanels);
    }

    if (this.error) {
      wrapper.appendChild(this.buildMessage(this.error));
    }

    return wrapper;
  },

  applyTheme: function (element) {
    const colors = Object.assign({}, this.defaults.colors, this.config.colors || {});
    const aspectRatio = this.positiveNumber(this.config.mapAspectRatio, this.defaults.mapAspectRatio);
    const widthFromConfig = this.positiveNumber(this.config.width, this.defaults.width);
    const heightFromConfig = this.positiveNumber(this.config.height, widthFromConfig / aspectRatio);
    const heightOnlyConfig = this.hasUserConfigOption("height") && !this.hasUserConfigOption("width");
    const width = this.config.fitWidthToHeight === true || heightOnlyConfig ?
      heightFromConfig * aspectRatio :
      widthFromConfig;
    const maxWidthVw = this.positiveNumber(this.config.maxWidthVw, this.defaults.maxWidthVw);

    element.style.setProperty("--ham-width", `${width}px`);
    element.style.setProperty("--ham-height", `${heightFromConfig}px`);
    element.style.setProperty("--ham-map-aspect-ratio", `${aspectRatio} / 1`);
    element.style.setProperty("--ham-max-vw", `${maxWidthVw}vw`);

    Object.keys(colors).forEach((key) => {
      element.style.setProperty(`--ham-${this.cssVarName(key)}`, colors[key]);
    });
  },

  hasUserConfigOption: function (key) {
    const userConfig = this.data && this.data.config ? this.data.config : {};
    return Object.prototype.hasOwnProperty.call(userConfig, key);
  },

  positiveNumber: function (value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  },

  buildHeader: function () {
    const header = document.createElement("div");
    header.className = this.config.showUtcTime ? "ham-header" : "ham-header ham-header--no-utc";

    const title = document.createElement("div");
    title.className = "ham-title";
    title.textContent = this.config.title;

    const utcTime = document.createElement("div");
    utcTime.className = "ham-utc-time";
    utcTime.textContent = this.formatUtcTime(new Date());

    const meta = document.createElement("div");
    meta.className = "ham-meta";
    meta.textContent = `${this.stationMetaLabel()}  ${this.formatLatLon(this.station)}  ${this.status}`;

    const updated = document.createElement("div");
    updated.className = "ham-updated";
    updated.textContent = this.lastUpdated ? `Updated ${this.formatTime(this.lastUpdated)}` : "Waiting for feed";

    header.appendChild(title);
    if (this.config.showUtcTime) {
      header.appendChild(utcTime);
    }
    header.appendChild(meta);
    header.appendChild(updated);
    return header;
  },

  stationDisplayLabel: function () {
    const callsign = String(this.config.stationCallsign || this.config.callsign || "").trim().toUpperCase();
    return callsign || String(this.config.gridLocator || "").trim().toUpperCase();
  },

  stationMetaLabel: function () {
    const label = this.stationDisplayLabel();
    const grid = String(this.config.gridLocator || "").trim().toUpperCase();

    if (label && grid && label !== grid) {
      return `${label} ${grid}`;
    }

    return label || grid;
  },

  buildConditionStrip: function () {
    const strip = document.createElement("div");
    strip.className = "ham-condition-strip";

    const muf = this.currentMuf();
    const stats = [
      { label: muf.estimated ? "MUF EST" : "MUF", value: muf.value, suffix: "MHz", quality: this.qualityForMuf(muf.value) },
      { label: "SFI", value: this.solar.solarFlux, quality: this.qualityForSfi(this.solar.solarFlux) },
      { label: "Kp", value: this.solar.kIndex, quality: this.qualityForKp(this.solar.kIndex) },
      { label: "Sunspots", value: this.solar.sunspots, quality: this.qualityForSunspots(this.solar.sunspots) },
      { label: "X-Ray", value: this.solar.xray, quality: this.qualityForXray(this.solar.xray) }
    ];

    stats.forEach((stat) => {
      const item = document.createElement("div");
      item.className = `ham-condition ham-condition--${stat.quality || "unknown"}`;

      const value = document.createElement("div");
      value.className = "ham-condition-value";
      value.textContent = this.formatStatValue(stat.value, stat.suffix);

      const label = document.createElement("div");
      label.className = "ham-condition-label";
      label.textContent = stat.label;

      item.appendChild(value);
      item.appendChild(label);
      strip.appendChild(item);
    });

    return strip;
  },

  buildMap: function () {
    const frame = document.createElement("div");
    frame.className = "ham-map-frame";

    const svg = this.svg("svg", {
      class: "ham-map",
      viewBox: "0 0 1000 500",
      role: "img",
      "aria-label": "World map with greyline and satellite tracks"
    });

    this.appendMapDefs(svg);
    svg.appendChild(this.svg("rect", { class: "ham-map-bg", x: 0, y: 0, width: 1000, height: 500 }));

    this.drawContinents(svg);

    if (this.config.showGraticule) {
      this.drawGraticule(svg);
    }

    if (this.config.showGreyline) {
      this.drawGreyline(svg, new Date());
    }

    this.drawSatellites(svg, new Date());
    this.drawStation(svg);

    frame.appendChild(svg);
    return frame;
  },

  appendMapDefs: function (svg) {
    const defs = this.svg("defs");
    const glow = this.svg("filter", { id: `${this.instanceId}-glow`, x: "-40%", y: "-40%", width: "180%", height: "180%" });
    glow.appendChild(this.svg("feGaussianBlur", { stdDeviation: 3, result: "blur" }));
    const merge = this.svg("feMerge");
    merge.appendChild(this.svg("feMergeNode", { in: "blur" }));
    merge.appendChild(this.svg("feMergeNode", { in: "SourceGraphic" }));
    glow.appendChild(merge);
    defs.appendChild(glow);
    svg.appendChild(defs);
  },

  drawContinents: function (svg) {
    const land = this.svg("g", { class: "ham-land" });

    if (this.landFeatures && this.landFeatures.length > 0) {
      this.drawGeoJsonLand(land);
    } else {
      this.drawFallbackLand(land);
    }

    svg.appendChild(land);
  },

  drawGeoJsonLand: function (land) {
    this.landFeatures.forEach((feature) => {
      if (feature && feature.geometry) {
        this.drawLandGeometry(land, feature.geometry);
      }
    });
  },

  drawLandGeometry: function (land, geometry) {
    if (geometry.type === "Polygon") {
      this.drawLandPolygon(land, geometry.coordinates);
      return;
    }

    if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach((polygon) => this.drawLandPolygon(land, polygon));
    }
  },

  drawLandPolygon: function (land, rings) {
    if (!Array.isArray(rings) || rings.length === 0) {
      return;
    }

    [-360, 0, 360].forEach((lonOffset) => {
      const path = this.landPolygonPath(rings, lonOffset);

      if (path) {
        land.appendChild(this.svg("path", {
          d: path,
          class: "ham-continent",
          "fill-rule": "evenodd"
        }));
      }
    });
  },

  landPolygonPath: function (rings, lonOffset) {
    const outer = rings[0] || [];
    const outerPoints = this.landProjectedRing(outer, lonOffset);

    if (outerPoints.length < 3 || this.projectedBoundsOutside(outerPoints)) {
      return "";
    }

    return rings
      .map((ring) => this.landProjectedRing(ring, lonOffset))
      .filter((ring) => ring.length >= 3)
      .map((ring) => this.pathFromProjectedSegment(ring, { closed: true, smooth: false }))
      .join(" ");
  },

  landProjectedRing: function (ring, lonOffset) {
    if (!Array.isArray(ring)) {
      return [];
    }

    return ring
      .filter((point) => Array.isArray(point) && point.length >= 2)
      .map((point) => this.projectUnwrapped(point[0] + lonOffset, point[1]));
  },

  projectedBoundsOutside: function (points) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);

    return maxX < -35 || minX > 1035 || maxY < -20 || minY > 520;
  },

  drawFallbackLand: function (land) {
    this.continents().forEach((continent) => {
      land.appendChild(this.svg("path", {
        d: this.pathFromLonLat(continent),
        class: "ham-continent"
      }));
    });
  },

  drawGraticule: function (svg) {
    const grid = this.svg("g", { class: "ham-graticule" });

    for (let lon = -150; lon <= 150; lon += 30) {
      const top = this.project(lon, 90);
      const bottom = this.project(lon, -90);
      grid.appendChild(this.svg("line", { x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y }));
    }

    for (let lat = -60; lat <= 60; lat += 30) {
      const point = this.project(this.mapCenterLon(), lat);
      grid.appendChild(this.svg("line", { x1: 0, y1: point.y, x2: 1000, y2: point.y }));
    }

    svg.appendChild(grid);
  },

  drawGreyline: function (svg, date) {
    const shade = this.svg("g", { class: "ham-greyline" });
    const samples = this.terminatorSamples(date, 2);

    this.nightShadePaths(samples).forEach((path) => {
      shade.appendChild(this.svg("path", {
        d: path,
        class: "ham-night-shade"
      }));
    });

    this.boundaryPathSegments(samples).forEach((linePath) => {
      shade.appendChild(this.svg("path", {
        d: linePath,
        class: "ham-greyline-band"
      }));
    });

    svg.appendChild(shade);
  },

  terminatorSamples: function (date, threshold) {
    const samples = [];
    const stepX = 5;

    for (let x = 0; x <= 1000; x += stepX) {
      const lon = this.lonFromX(x);
      const topAltitude = this.solarAltitude(89.8, lon, date).altitude - threshold;
      const bottomAltitude = this.solarAltitude(-89.8, lon, date).altitude - threshold;

      if (topAltitude < 0 && bottomAltitude < 0) {
        samples.push({ x, allNight: true });
        continue;
      }

      if (topAltitude >= 0 && bottomAltitude >= 0) {
        samples.push({ x, allDay: true });
        continue;
      }

      const boundaryLat = this.boundaryLatitude(lon, date, threshold);
      const projected = this.project(lon, boundaryLat);
      samples.push({
        x,
        y: projected.y,
        boundary: true,
        topNight: topAltitude < 0
      });
    }

    return samples;
  },

  boundaryLatitude: function (lon, date, threshold) {
    let low = -89.8;
    let high = 89.8;
    const lowAltitude = this.solarAltitude(low, lon, date).altitude - threshold;

    for (let index = 0; index < 18; index += 1) {
      const mid = (low + high) / 2;
      const midAltitude = this.solarAltitude(mid, lon, date).altitude - threshold;

      if ((midAltitude >= 0) === (lowAltitude >= 0)) {
        low = mid;
      } else {
        high = mid;
      }
    }

    return (low + high) / 2;
  },

  nightShadePaths: function (samples) {
    const paths = [];
    let segment = [];

    const flush = () => {
      if (segment.length < 2) {
        segment = [];
        return;
      }

      const side = segment[0].topNight ? "top" : "bottom";
      const boundary = segment.map((sample) => ({ x: sample.x, y: sample.y }));
      const edge = side === "top" ? 0 : 500;
      const forwardEdge = boundary.map((point) => ({ x: point.x, y: edge }));
      const polygon = side === "top" ?
        forwardEdge.concat(boundary.slice().reverse()) :
        boundary.concat(forwardEdge.slice().reverse());

      paths.push(this.pathFromProjectedSegment(polygon, { closed: true, smooth: false }));
      segment = [];
    };

    samples.forEach((sample, index) => {
      if (sample.allNight) {
        flush();
        const nextX = samples[index + 1] ? samples[index + 1].x : sample.x + 5;
        paths.push(`M ${sample.x.toFixed(1)} 0 L ${nextX.toFixed(1)} 0 L ${nextX.toFixed(1)} 500 L ${sample.x.toFixed(1)} 500 Z`);
        return;
      }

      if (!sample.boundary) {
        flush();
        return;
      }

      if (segment.length > 0 && segment[0].topNight !== sample.topNight) {
        flush();
      }

      segment.push(sample);
    });

    flush();
    return paths;
  },

  boundaryPathSegments: function (samples) {
    const paths = [];
    let segment = [];

    const flush = () => {
      if (segment.length > 1) {
        paths.push(this.pathFromProjectedSegment(segment, { smooth: true }));
      }
      segment = [];
    };

    samples.forEach((sample) => {
      if (!sample.boundary) {
        flush();
        return;
      }

      if (segment.length > 0 && Math.abs(sample.x - segment[segment.length - 1].x) > 8) {
        flush();
      }

      segment.push({ x: sample.x, y: sample.y });
    });

    flush();
    return paths;
  },

  drawStation: function (svg) {
    const point = this.project(this.station.lon, this.station.lat);
    const station = this.svg("g", { class: "ham-station", filter: `url(#${this.instanceId}-glow)` });
    station.appendChild(this.svg("circle", { cx: point.x, cy: point.y, r: 5 }));
    station.appendChild(this.svg("circle", { cx: point.x, cy: point.y, r: 14, class: "ham-station-ring" }));
    station.appendChild(this.svg("text", { x: point.x + 13, y: point.y - 10 }, this.stationDisplayLabel()));
    svg.appendChild(station);
  },

  drawSatellites: function (svg, date) {
    const layer = this.svg("g", { class: "ham-satellites" });
    const satellites = this.satellitesWithTle();
    const animationMs = this.mapUpdateIntervalMs();

    satellites.forEach((satellite) => {
      const position = this.propagateSatellite(satellite.tle, date);
      if (!position) {
        return;
      }

      const color = satellite.color || "#ffffff";

      if (this.config.showSatelliteFootprints) {
        this.drawFootprint(layer, position, color);
      }

      if (this.config.showSatelliteTracks) {
        this.drawTrack(layer, satellite, date, color);
      }

      const point = this.project(position.lon, position.lat);
      const active = this.elevationFor(this.station, position) >= 0;
      const satGroup = this.svg("g", { class: active ? "ham-sat ham-sat--active" : "ham-sat" });
      const nextPosition = this.propagateSatellite(satellite.tle, new Date(date.getTime() + animationMs));
      const nextPoint = nextPosition ? this.project(nextPosition.lon, nextPosition.lat) : null;

      if (nextPoint && Math.abs(nextPoint.x - point.x) < 220 && Math.abs(nextPoint.y - point.y) < 160) {
        satGroup.appendChild(this.svg("animateTransform", {
          attributeName: "transform",
          type: "translate",
          from: "0 0",
          to: `${(nextPoint.x - point.x).toFixed(1)} ${(nextPoint.y - point.y).toFixed(1)}`,
          dur: `${animationMs}ms`,
          fill: "freeze"
        }));
      }

      satGroup.appendChild(this.svg("circle", {
        cx: point.x,
        cy: point.y,
        r: active ? 5 : 4,
        fill: color
      }));

      if (this.config.showSatelliteLabels) {
        satGroup.appendChild(this.svg("text", {
          x: point.x + 8,
          y: point.y - 7,
          fill: color
        }, satellite.name || satellite.tle.name));
      }

      layer.appendChild(satGroup);
    });

    svg.appendChild(layer);
  },

  drawTrack: function (layer, satellite, date, color) {
    const points = [];
    const windowMinutes = this.trackWindowMinutes(satellite.tle);
    const before = windowMinutes.before;
    const after = windowMinutes.after;
    const step = Math.max(1, Number(this.config.trackStepMinutes) || 1);

    for (let minute = -before; minute <= after; minute += step) {
      const position = this.propagateSatellite(satellite.tle, new Date(date.getTime() + minute * 60000));
      if (position) {
        points.push(position);
      }
    }

    this.segmentedPathData(points, { smooth: true }).forEach((path) => {
      layer.appendChild(this.svg("path", {
        d: path,
        class: "ham-sat-track",
        stroke: color
      }));
    });
  },

  trackWindowMinutes: function (tle) {
    const wavelengths = Number(this.config.trackWavelengths);
    const meanMotion = tle ? Number(tle.meanMotion) : 0;

    if (Number.isFinite(wavelengths) && wavelengths > 0 && Number.isFinite(meanMotion) && meanMotion > 0) {
      const orbitalPeriodMinutes = 1440 / meanMotion;
      const halfWindow = Math.max(1, orbitalPeriodMinutes * wavelengths / 2);

      return {
        before: Math.round(halfWindow),
        after: Math.round(halfWindow)
      };
    }

    return {
      before: Number(this.config.trackMinutesBefore) || this.defaults.trackMinutesBefore,
      after: Number(this.config.trackMinutesAfter) || this.defaults.trackMinutesAfter
    };
  },

  drawFootprint: function (layer, position, color) {
    if (!Number.isFinite(position.altKm) || position.altKm <= 0) {
      return;
    }

    const angle = Math.acos(HAMDisplayEarthRadiusKm / (HAMDisplayEarthRadiusKm + position.altKm));
    const points = [];

    for (let bearing = 0; bearing <= 360; bearing += 6) {
      points.push(this.destinationPoint(position.lat, position.lon, angle, bearing));
    }

    this.segmentedPathData(points, { closed: true, smooth: true }).forEach((path) => {
      layer.appendChild(this.svg("path", {
        d: path,
        class: "ham-sat-footprint",
        stroke: color
      }));
    });
  },

  buildLowerPanels: function () {
    const panels = document.createElement("div");
    panels.className = "ham-panels";

    if (this.config.showBandPanel) {
      panels.appendChild(this.buildBandPanel());
    }

    if (this.config.showSatellitePanel) {
      panels.appendChild(this.buildSatellitePanel());
    }

    return panels.children.length > 0 ? panels : null;
  },

  buildBandPanel: function () {
    const panel = document.createElement("div");
    panel.className = "ham-panel ham-band-panel";

    const title = document.createElement("div");
    title.className = "ham-panel-title";
    title.textContent = "Best Bands Now";
    panel.appendChild(title);

    const bands = document.createElement("div");
    bands.className = "ham-band-grid";
    this.bandRecommendations().forEach((band) => {
      const item = document.createElement("div");
      item.className = `ham-band ham-band--${band.quality}`;

      const name = document.createElement("div");
      name.className = "ham-band-name";
      name.textContent = band.name;

      const quality = document.createElement("div");
      quality.className = "ham-band-quality";
      quality.textContent = band.label;

      item.appendChild(name);
      item.appendChild(quality);
      bands.appendChild(item);
    });

    panel.appendChild(bands);
    return panel;
  },

  buildSatellitePanel: function () {
    const panel = document.createElement("div");
    panel.className = "ham-panel ham-pass-panel";

    const title = document.createElement("div");
    title.className = "ham-panel-title";
    title.textContent = "Satellite Passes";
    panel.appendChild(title);

    const passes = this.nextPasses().slice(0, this.maxPasses());
    if (passes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ham-empty";
      empty.textContent = this.satellitesWithTle().length ? "No strong passes soon" : "Waiting for TLEs";
      panel.appendChild(empty);
      return panel;
    }

    passes.forEach((pass) => {
      const row = document.createElement("div");
      row.className = pass.inView ? "ham-pass ham-pass--active" : "ham-pass";

      const name = document.createElement("div");
      name.className = "ham-pass-name";
      name.textContent = pass.name;

      const frequency = document.createElement("div");
      frequency.className = "ham-pass-frequency";
      frequency.textContent = this.config.showPassFrequencies ? (pass.frequencyText || "") : "";

      const detail = document.createElement("div");
      detail.className = "ham-pass-detail";
      detail.textContent = pass.inView ?
        `Now ${Math.round(pass.currentElevation)}deg` :
        `${this.formatShortTime(pass.start)} ${Math.round(pass.maxElevation)}deg`;

      row.appendChild(name);
      row.appendChild(frequency);
      row.appendChild(detail);
      panel.appendChild(row);
    });

    return panel;
  },

  buildMessage: function (message) {
    const element = document.createElement("div");
    element.className = "ham-message";
    element.textContent = message;
    return element;
  },

  bandRecommendations: function () {
    const muf = this.currentMuf().value || 14;
    const kp = Number(this.solar.kIndex);
    const stationSun = this.solarAltitude(this.station.lat, this.station.lon, new Date()).altitude;
    const isDay = stationSun > -4;

    return [
      { name: "80m", mhz: 3.8 },
      { name: "40m", mhz: 7.2 },
      { name: "30m", mhz: 10.1 },
      { name: "20m", mhz: 14.2 },
      { name: "17m", mhz: 18.1 },
      { name: "15m", mhz: 21.2 },
      { name: "12m", mhz: 24.9 },
      { name: "10m", mhz: 28.4 }
    ].map((band) => {
      let score = 0;

      if (band.mhz <= muf * 0.82) {
        score += 2;
      } else if (band.mhz <= muf * 1.06) {
        score += 1;
      } else {
        score -= 1;
      }

      if (isDay && band.mhz >= 14 && band.mhz <= muf * 1.04) {
        score += 1;
      }

      if (!isDay && band.mhz <= 10.2) {
        score += 2;
      }

      if (!isDay && band.mhz >= 18) {
        score -= 1;
      }

      if (Number.isFinite(kp) && kp >= 5) {
        score -= band.mhz >= 14 ? 2 : 1;
      }

      if (score >= 3) {
        return Object.assign({}, band, { quality: "good", label: "Good" });
      }

      if (score >= 1) {
        return Object.assign({}, band, { quality: "fair", label: "Fair" });
      }

      return Object.assign({}, band, { quality: "poor", label: "Poor" });
    });
  },

  nextPasses: function () {
    const now = new Date();
    const satellites = this.satellitesWithTle();
    const passes = satellites.map((satellite) => {
      const current = this.propagateSatellite(satellite.tle, now);
      const currentElevation = current ? this.elevationFor(this.station, current) : -90;
      const next = this.findNextPass(satellite, now);
      return Object.assign({
        name: satellite.name || satellite.tle.name,
        inView: currentElevation >= 0,
        currentElevation,
        frequencyText: this.satelliteFrequencyText(satellite)
      }, next || {});
    }).filter((pass) => pass.inView || pass.start);

    return passes.sort((a, b) => {
      if (a.inView && !b.inView) return -1;
      if (!a.inView && b.inView) return 1;
      return (a.start ? a.start.getTime() : 0) - (b.start ? b.start.getTime() : 0);
    });
  },

  findNextPass: function (satellite, now) {
    const lookAheadHours = Number(this.config.passLookAheadHours) || 12;
    const stepMinutes = Math.max(1, Number(this.config.passStepMinutes) || 2);
    const minElevation = Number(this.config.minElevation) || 0;
    let active = null;

    for (let minute = 0; minute <= lookAheadHours * 60; minute += stepMinutes) {
      const time = new Date(now.getTime() + minute * 60000);
      const position = this.propagateSatellite(satellite.tle, time);
      const elevation = position ? this.elevationFor(this.station, position) : -90;

      if (elevation >= minElevation) {
        if (!active) {
          active = {
            start: time,
            maxElevation: elevation
          };
        }
        active.maxElevation = Math.max(active.maxElevation, elevation);
      } else if (active) {
        active.end = time;
        return active;
      }
    }

    return active;
  },

  satellitesWithTle: function () {
    const feedItems = this.satelliteFeed && Array.isArray(this.satelliteFeed.items) ? this.satelliteFeed.items : [];
    return feedItems.filter((item) => item && item.tle);
  },

  satelliteFrequencyText: function (satellite) {
    const uplink = this.firstPresent(
      satellite.uplink,
      satellite.uplinkFrequency,
      satellite.uplinkMHz,
      satellite.frequencies && satellite.frequencies.uplink
    );
    const downlink = this.firstPresent(
      satellite.downlink,
      satellite.downlinkFrequency,
      satellite.downlinkMHz,
      satellite.frequencies && satellite.frequencies.downlink,
      satellite.frequency
    );
    const mode = this.firstPresent(satellite.mode, satellite.radioMode);
    const parts = [];

    if (mode) {
      parts.push(String(mode));
    }

    if (uplink && downlink && String(uplink).trim() === String(downlink).trim()) {
      parts.push(`${this.formatFrequencyValue(uplink)} U/D`);
    } else {
      if (uplink) {
        parts.push(`${this.formatFrequencyValue(uplink)} U`);
      }

      if (downlink) {
        parts.push(`${this.formatFrequencyValue(downlink)} D`);
      }
    }

    return parts.join(" ");
  },

  firstPresent: function () {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = arguments[index];

      if (value !== null && typeof value !== "undefined" && value !== "") {
        return value;
      }
    }

    return null;
  },

  formatFrequencyValue: function (value) {
    if (Array.isArray(value)) {
      return value.map((item) => this.formatFrequencyValue(item)).join("/");
    }

    if (typeof value === "number") {
      const mhz = value >= 1000000 ? value / 1000000 : (value >= 1000 ? value / 1000 : value);
      return mhz.toFixed(3);
    }

    return this.compactFrequencyRange(String(value).replace(/\s*MHz\b/gi, "").trim());
  },

  compactFrequencyRange: function (value) {
    return String(value).replace(/\b(\d{3})\.(\d{3})-(\d{3})\.(\d{3})\b/g, (match, firstPrefix, firstSuffix, secondPrefix, secondSuffix) => {
      if (firstPrefix !== secondPrefix) {
        return match;
      }

      return `${firstPrefix}.${firstSuffix}-.${secondSuffix}`;
    });
  },

  currentMuf: function () {
    const feedMuf = Number(this.solar.muf);
    if (Number.isFinite(feedMuf) && feedMuf > 0) {
      return { value: feedMuf, estimated: false };
    }

    const sfi = Number(this.solar.solarFlux);
    const sunspots = Number(this.solar.sunspots);
    const kp = Number(this.solar.kIndex);
    let estimate = 14;

    if (Number.isFinite(sfi)) {
      estimate += (sfi - 100) * 0.14;
    }

    if (Number.isFinite(sunspots)) {
      estimate += sunspots * 0.025;
    }

    if (Number.isFinite(kp)) {
      estimate -= Math.max(0, kp - 3) * 1.4;
    }

    return {
      value: Math.max(6, Math.min(42, estimate)),
      estimated: true
    };
  },

  qualityForMuf: function (value) {
    if (!Number.isFinite(Number(value))) return "unknown";
    if (value >= 24) return "good";
    if (value >= 14) return "fair";
    return "poor";
  },

  qualityForSfi: function (value) {
    if (!Number.isFinite(Number(value))) return "unknown";
    if (value >= 150) return "good";
    if (value >= 100) return "fair";
    return "poor";
  },

  qualityForKp: function (value) {
    if (!Number.isFinite(Number(value))) return "unknown";
    if (value <= 2) return "good";
    if (value <= 4) return "fair";
    return "poor";
  },

  qualityForSunspots: function (value) {
    if (!Number.isFinite(Number(value))) return "unknown";
    if (value >= 100) return "good";
    if (value >= 40) return "fair";
    return "poor";
  },

  qualityForXray: function (value) {
    const text = String(value || "").trim().toUpperCase();
    if (!text) return "unknown";
    if (text.startsWith("X") || text.startsWith("M")) return "poor";
    if (text.startsWith("C")) return "fair";
    return "good";
  },

  formatStatValue: function (value, suffix) {
    if (value === null || typeof value === "undefined" || value === "") {
      return "--";
    }

    if (typeof value === "number") {
      const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
      return suffix ? `${rounded} ${suffix}` : String(rounded);
    }

    return suffix ? `${value} ${suffix}` : String(value);
  },

  formatTime: function (date) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  },

  formatUtcTime: function (date) {
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
  },

  formatShortTime: function (date) {
    const hours = date.getHours();
    const hour = hours % 12 || 12;
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${hour}:${minute}${hours < 12 ? "a" : "p"}`;
  },

  formatLatLon: function (point) {
    const lat = Math.abs(point.lat).toFixed(2);
    const lon = Math.abs(point.lon).toFixed(2);
    return `${lat}${point.lat >= 0 ? "N" : "S"} ${lon}${point.lon >= 0 ? "E" : "W"}`;
  },

  gridToLatLon: function (grid) {
    const value = String(grid || "").trim().toUpperCase();
    if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(value)) {
      return null;
    }

    let lon = -180 + (value.charCodeAt(0) - 65) * 20;
    let lat = -90 + (value.charCodeAt(1) - 65) * 10;
    let lonSize = 20;
    let latSize = 10;

    lon += Number(value[2]) * 2;
    lat += Number(value[3]);
    lonSize = 2;
    latSize = 1;

    if (value.length >= 6) {
      lon += (value.charCodeAt(4) - 65) * (5 / 60);
      lat += (value.charCodeAt(5) - 65) * (2.5 / 60);
      lonSize = 5 / 60;
      latSize = 2.5 / 60;
    }

    return {
      lat: lat + latSize / 2,
      lon: lon + lonSize / 2
    };
  },

  solarAltitude: function (lat, lon, date) {
    const sun = this.subsolarPoint(date);
    const latRad = this.degToRad(lat);
    const sunLatRad = this.degToRad(sun.lat);
    const hourAngle = this.degToRad(this.normalizeLon(lon - sun.lon));
    const sinAlt = Math.sin(latRad) * Math.sin(sunLatRad) + Math.cos(latRad) * Math.cos(sunLatRad) * Math.cos(hourAngle);

    return {
      altitude: this.radToDeg(Math.asin(Math.max(-1, Math.min(1, sinAlt)))),
      sun
    };
  },

  subsolarPoint: function (date) {
    const jd = this.julianDate(date);
    const n = jd - 2451545.0;
    const meanLong = this.normalizeDeg(280.460 + 0.9856474 * n);
    const meanAnom = this.normalizeDeg(357.528 + 0.9856003 * n);
    const lambda = this.normalizeDeg(meanLong + 1.915 * Math.sin(this.degToRad(meanAnom)) + 0.020 * Math.sin(this.degToRad(2 * meanAnom)));
    const epsilon = 23.439 - 0.0000004 * n;
    const rightAscension = this.normalizeDeg(this.radToDeg(Math.atan2(
      Math.cos(this.degToRad(epsilon)) * Math.sin(this.degToRad(lambda)),
      Math.cos(this.degToRad(lambda))
    )));
    const declination = this.radToDeg(Math.asin(Math.sin(this.degToRad(epsilon)) * Math.sin(this.degToRad(lambda))));
    const gmst = this.gmstDeg(date);

    return {
      lat: declination,
      lon: this.normalizeLon(rightAscension - gmst)
    };
  },

  propagateSatellite: function (tle, date) {
    if (!tle || !Number.isFinite(Number(tle.meanMotion))) {
      return null;
    }

    const inclination = this.degToRad(Number(tle.inclination));
    const raan = this.degToRad(Number(tle.raan));
    const eccentricity = Number(tle.eccentricity) || 0;
    const argPerigee = this.degToRad(Number(tle.argumentOfPerigee));
    const meanAnomaly0 = this.degToRad(Number(tle.meanAnomaly));
    const meanMotion = Number(tle.meanMotion) * HAMDisplayTau / 86400;
    const semiMajor = Math.pow(HAMDisplayEarthMu / (meanMotion * meanMotion), 1 / 3);
    const dt = (date.getTime() - Number(tle.epoch)) / 1000;
    const meanAnomaly = this.normalizeRad(meanAnomaly0 + meanMotion * dt);
    const eccentricAnomaly = this.solveKepler(meanAnomaly, eccentricity);
    const cosE = Math.cos(eccentricAnomaly);
    const sinE = Math.sin(eccentricAnomaly);
    const radius = semiMajor * (1 - eccentricity * cosE);
    const trueAnomaly = Math.atan2(Math.sqrt(1 - eccentricity * eccentricity) * sinE, cosE - eccentricity);
    const argLat = argPerigee + trueAnomaly;

    const cosO = Math.cos(raan);
    const sinO = Math.sin(raan);
    const cosI = Math.cos(inclination);
    const sinI = Math.sin(inclination);
    const cosU = Math.cos(argLat);
    const sinU = Math.sin(argLat);

    const xEci = radius * (cosO * cosU - sinO * sinU * cosI);
    const yEci = radius * (sinO * cosU + cosO * sinU * cosI);
    const zEci = radius * (sinU * sinI);
    const theta = this.degToRad(this.gmstDeg(date));
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const x = cosT * xEci + sinT * yEci;
    const y = -sinT * xEci + cosT * yEci;
    const z = zEci;
    const range = Math.sqrt(x * x + y * y + z * z);

    return {
      lat: this.radToDeg(Math.asin(z / range)),
      lon: this.normalizeLon(this.radToDeg(Math.atan2(y, x))),
      altKm: range - HAMDisplayEarthRadiusKm
    };
  },

  solveKepler: function (meanAnomaly, eccentricity) {
    let eccentricAnomaly = meanAnomaly;

    for (let index = 0; index < 8; index += 1) {
      eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly) /
        (1 - eccentricity * Math.cos(eccentricAnomaly));
    }

    return eccentricAnomaly;
  },

  elevationFor: function (station, satellite) {
    const centralAngle = this.centralAngle(station.lat, station.lon, satellite.lat, satellite.lon);
    const ratio = HAMDisplayEarthRadiusKm / (HAMDisplayEarthRadiusKm + Math.max(1, satellite.altKm || 1));
    const elevation = Math.atan2(Math.cos(centralAngle) - ratio, Math.sin(centralAngle));
    return this.radToDeg(elevation);
  },

  destinationPoint: function (lat, lon, distanceRad, bearingDeg) {
    const lat1 = this.degToRad(lat);
    const lon1 = this.degToRad(lon);
    const bearing = this.degToRad(bearingDeg);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceRad) + Math.cos(lat1) * Math.sin(distanceRad) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(distanceRad) * Math.cos(lat1),
      Math.cos(distanceRad) - Math.sin(lat1) * Math.sin(lat2)
    );

    return {
      lat: this.radToDeg(lat2),
      lon: this.normalizeLon(this.radToDeg(lon2))
    };
  },

  centralAngle: function (lat1, lon1, lat2, lon2) {
    const phi1 = this.degToRad(lat1);
    const phi2 = this.degToRad(lat2);
    const deltaPhi = this.degToRad(lat2 - lat1);
    const deltaLambda = this.degToRad(this.normalizeLon(lon2 - lon1));
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  julianDate: function (date) {
    return date.getTime() / 86400000 + 2440587.5;
  },

  gmstDeg: function (date) {
    const jd = this.julianDate(date);
    const t = (jd - 2451545.0) / 36525;
    return this.normalizeDeg(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000);
  },

  project: function (lon, lat) {
    return {
      x: ((this.normalizeLon(lon - this.mapCenterLon()) + 180) / 360) * 1000,
      y: ((90 - Math.max(-90, Math.min(90, lat))) / 180) * 500
    };
  },

  projectUnwrapped: function (lon, lat) {
    return {
      x: ((lon - this.mapCenterLon() + 180) / 360) * 1000,
      y: ((90 - Math.max(-90, Math.min(90, lat))) / 180) * 500
    };
  },

  mapCenterLon: function () {
    return this.station && Number.isFinite(this.station.lon) ? this.station.lon : 0;
  },

  lonFromX: function (x) {
    return this.normalizeLon((x / 1000) * 360 - 180 + this.mapCenterLon());
  },

  segmentedPathData: function (points, options) {
    const settings = typeof options === "boolean" ? { closed: options } : (options || {});
    const paths = [];
    let segment = [];
    let previous = null;

    points.forEach((point) => {
      const projected = this.project(point.lon, point.lat);
      if (!previous || Math.abs(projected.x - previous.x) > 420) {
        if (segment.length > 0) {
          paths.push(this.pathFromProjectedSegment(segment, settings));
        }
        segment = [projected];
      } else {
        segment.push(projected);
      }
      previous = projected;
    });

    if (segment.length > 0) {
      paths.push(this.pathFromProjectedSegment(segment, settings));
    }

    return paths;
  },

  pathFromProjectedSegment: function (segment, settings) {
    const closed = Boolean(settings.closed);
    const smooth = Boolean(settings.smooth) && segment.length > 2;

    if (!smooth) {
      return segment
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(" ") + (closed ? " Z" : "");
    }

    let path = `M ${segment[0].x.toFixed(1)} ${segment[0].y.toFixed(1)}`;

    for (let index = 0; index < segment.length - 1; index += 1) {
      const p0 = segment[index - 1] || segment[index];
      const p1 = segment[index];
      const p2 = segment[index + 1];
      const p3 = segment[index + 2] || p2;
      const c1 = {
        x: p1.x + (p2.x - p0.x) / 6,
        y: p1.y + (p2.y - p0.y) / 6
      };
      const c2 = {
        x: p2.x - (p3.x - p1.x) / 6,
        y: p2.y - (p3.y - p1.y) / 6
      };

      path += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }

    return path + (closed ? " Z" : "");
  },

  pathFromLonLat: function (points) {
    return this.segmentedPathData(points.map((point) => ({
      lon: Array.isArray(point) ? point[0] : point.lon,
      lat: Array.isArray(point) ? point[1] : point.lat
    })), { closed: true, smooth: true }).join(" ");
  },

  continents: function () {
    return [
      [[-168, 72], [-145, 71], [-128, 59], [-111, 55], [-95, 50], [-74, 50], [-58, 46], [-52, 57], [-42, 62], [-52, 44], [-65, 30], [-82, 24], [-96, 18], [-111, 27], [-124, 41], [-140, 58], [-168, 72]],
      [[-82, 13], [-69, 9], [-54, -5], [-38, -18], [-45, -35], [-54, -55], [-68, -51], [-76, -34], [-80, -12], [-82, 13]],
      [[-54, 60], [-42, 72], [-25, 76], [-18, 66], [-34, 58], [-54, 60]],
      [[-11, 36], [-6, 53], [18, 61], [45, 56], [73, 66], [108, 62], [138, 50], [154, 36], [133, 20], [107, 7], [82, 20], [62, 9], [40, 29], [22, 33], [7, 42], [-11, 36]],
      [[-18, 35], [7, 37], [31, 30], [50, 9], [42, -28], [29, -35], [12, -32], [-5, -21], [-15, 3], [-18, 35]],
      [[35, 31], [50, 29], [58, 20], [49, 12], [39, 15], [35, 31]],
      [[113, -11], [130, -10], [154, -20], [146, -39], [123, -36], [112, -24], [113, -11]],
      [[166, -35], [178, -41], [173, -47], [164, -44], [166, -35]],
      [[-180, -70], [-120, -73], [-60, -71], [0, -74], [60, -70], [120, -73], [180, -70], [180, -90], [-180, -90], [-180, -70]]
    ];
  },

  svg: function (tag, attrs, text) {
    const element = document.createElementNS(HAMDisplaySvgNs, tag);
    Object.keys(attrs || {}).forEach((key) => {
      element.setAttribute(key, attrs[key]);
    });
    if (typeof text !== "undefined") {
      element.textContent = text;
    }
    return element;
  },

  cssVarName: function (value) {
    return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
  },

  normalizeDeg: function (degrees) {
    return ((degrees % 360) + 360) % 360;
  },

  normalizeLon: function (degrees) {
    return ((((degrees + 180) % 360) + 360) % 360) - 180;
  },

  normalizeRad: function (radians) {
    return ((radians % HAMDisplayTau) + HAMDisplayTau) % HAMDisplayTau;
  },

  degToRad: function (degrees) {
    return degrees * Math.PI / 180;
  },

  radToDeg: function (radians) {
    return radians * 180 / Math.PI;
  }
});
