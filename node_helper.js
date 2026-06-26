const NodeHelper = require("node_helper");
const Log = require("logger");
const http = require("http");
const https = require("https");

const HAMDisplayNotifications = {
  CONFIG: "MMM_HAM_DISPLAY_CONFIG",
  REQUEST: "MMM_HAM_DISPLAY_REQUEST",
  UPDATE: "MMM_HAM_DISPLAY_UPDATE",
  ERROR: "MMM_HAM_DISPLAY_ERROR"
};

module.exports = NodeHelper.create({
  requiresVersion: "2.1.0",

  start: function () {
    this.configs = {};
    this.cache = {};
  },

  socketNotificationReceived: function (notification, payload) {
    if (!payload || !payload.instanceId) {
      return;
    }

    if (notification === HAMDisplayNotifications.CONFIG) {
      this.configs[payload.instanceId] = payload.config || {};
      return;
    }

    if (notification === HAMDisplayNotifications.REQUEST) {
      this.loadDisplayData(payload.instanceId).catch((error) => {
        Log.error(`${this.name}: ${error.message}`);
        this.sendSocketNotification(HAMDisplayNotifications.ERROR, {
          instanceId: payload.instanceId,
          message: error.message,
          generatedAt: Date.now()
        });
      });
    }
  },

  loadDisplayData: async function (instanceId) {
    const config = this.configs[instanceId] || {};
    const timeoutMs = Number(config.timeoutMs) || 9000;

    const [solarResult, satelliteResult] = await Promise.all([
      this.loadSolar(config, timeoutMs),
      this.loadSatellites(config, timeoutMs)
    ]);

    this.sendSocketNotification(HAMDisplayNotifications.UPDATE, {
      instanceId,
      solar: solarResult,
      satellites: satelliteResult,
      generatedAt: Date.now()
    });
  },

  loadSolar: async function (config, timeoutMs) {
    const url = config.hamqslSolarUrl || "https://www.hamqsl.com/solarxml.php";

    try {
      const text = await this.cachedText(url, timeoutMs, this.cacheMs(config.solarCacheMs, 10 * 60 * 1000));
      return this.parseHamQslSolar(text, url);
    } catch (error) {
      return {
        source: "HamQSL",
        url,
        error: error.message,
        generatedAt: Date.now()
      };
    }
  },

  loadSatellites: async function (config, timeoutMs) {
    const satellites = Array.isArray(config.satellites) ? config.satellites : [];
    const results = [];

    for (const satellite of satellites) {
      const item = Object.assign({}, satellite);

      try {
        const tleText = await this.tleTextForSatellite(satellite, config, timeoutMs);
        const tle = this.parseTle(tleText, satellite);

        if (!tle) {
          throw new Error("No matching TLE returned");
        }

        item.tle = tle;
        item.error = null;
      } catch (error) {
        item.tle = null;
        item.error = error.message;
      }

      results.push(item);
    }

    return {
      source: "CelesTrak",
      generatedAt: Date.now(),
      items: results
    };
  },

  tleTextForSatellite: async function (satellite, config, timeoutMs) {
    if (satellite.tle && Array.isArray(satellite.tle) && satellite.tle.length >= 2) {
      return satellite.tle.join("\n");
    }

    if (satellite.tle && typeof satellite.tle === "string") {
      return satellite.tle;
    }

    const url = satellite.tleUrl || this.celestrakUrl(satellite, config);
    return this.cachedText(url, timeoutMs, this.cacheMs(config.tleCacheMs, 6 * 60 * 60 * 1000));
  },

  celestrakUrl: function (satellite, config) {
    const baseUrl = config.celestrakBaseUrl || "https://celestrak.org/NORAD/elements/gp.php";
    const norad = satellite.norad || satellite.catalogNumber || satellite.catnr;

    if (!norad) {
      throw new Error(`Set norad or tleUrl for ${satellite.name || "satellite"}`);
    }

    return `${baseUrl}?CATNR=${encodeURIComponent(norad)}&FORMAT=TLE`;
  },

  parseHamQslSolar: function (xml, url) {
    const solar = {
      source: "HamQSL",
      url,
      generatedAt: Date.now(),
      updated: this.xmlTag(xml, "updated"),
      solarFlux: this.numberOrNull(this.xmlTag(xml, "solarflux")),
      aIndex: this.numberOrNull(this.xmlTag(xml, "aindex")),
      kIndex: this.numberOrNull(this.xmlTag(xml, "kindex")),
      xray: this.xmlTag(xml, "xray"),
      sunspots: this.numberOrNull(this.xmlTag(xml, "sunspots")),
      protonFlux: this.xmlTag(xml, "protonflux"),
      electronFlux: this.xmlTag(xml, "electronflux"),
      aurora: this.xmlTag(xml, "aurora"),
      latDegree: this.xmlTag(xml, "latdegree"),
      geomagField: this.xmlTag(xml, "geomagfield"),
      signalNoise: this.xmlTag(xml, "signalnoise"),
      muf: this.numberOrNull(this.xmlTag(xml, "muf")),
      conditions: []
    };

    const bandRegex = /<band\b([^>]*)>([\s\S]*?)<\/band>/gi;
    let match = bandRegex.exec(xml);

    while (match) {
      const attrs = this.xmlAttrs(match[1]);
      solar.conditions.push({
        name: attrs.name || "",
        time: attrs.time || "",
        condition: this.cleanXmlText(match[2])
      });
      match = bandRegex.exec(xml);
    }

    return solar;
  },

  parseTle: function (text, satellite) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].startsWith("1 ") && lines[index + 1] && lines[index + 1].startsWith("2 ")) {
        return this.tleObject(satellite.name || satellite.label || "Satellite", lines[index], lines[index + 1], satellite);
      }

      if (lines[index + 1] && lines[index + 1].startsWith("1 ") && lines[index + 2] && lines[index + 2].startsWith("2 ")) {
        return this.tleObject(lines[index], lines[index + 1], lines[index + 2], satellite);
      }
    }

    return null;
  },

  tleObject: function (name, line1, line2, satellite) {
    const epochYear = Number(line1.slice(18, 20));
    const epochDay = Number(line1.slice(20, 32));
    const fullYear = epochYear < 57 ? 2000 + epochYear : 1900 + epochYear;
    const epoch = Date.UTC(fullYear, 0, 1, 0, 0, 0, 0) + (epochDay - 1) * 86400000;

    return {
      name,
      norad: satellite.norad || Number(line1.slice(2, 7)),
      line1,
      line2,
      epoch,
      inclination: this.numberOrNull(line2.slice(8, 16)),
      raan: this.numberOrNull(line2.slice(17, 25)),
      eccentricity: this.numberOrNull(`0.${line2.slice(26, 33).trim()}`),
      argumentOfPerigee: this.numberOrNull(line2.slice(34, 42)),
      meanAnomaly: this.numberOrNull(line2.slice(43, 51)),
      meanMotion: this.numberOrNull(line2.slice(52, 63))
    };
  },

  xmlTag: function (xml, tagName) {
    const match = String(xml || "").match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
    return match ? this.cleanXmlText(match[1]) : null;
  },

  xmlAttrs: function (attrText) {
    const attrs = {};
    const attrRegex = /([a-z0-9_-]+)\s*=\s*["']([^"']*)["']/gi;
    let match = attrRegex.exec(attrText || "");

    while (match) {
      attrs[match[1].toLowerCase()] = this.cleanXmlText(match[2]);
      match = attrRegex.exec(attrText || "");
    }

    return attrs;
  },

  cleanXmlText: function (value) {
    return String(value || "")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .trim();
  },

  numberOrNull: function (value) {
    const number = Number(String(value || "").replace(/[^\d.+-]/g, ""));
    return Number.isFinite(number) ? number : null;
  },

  cacheMs: function (value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  },

  cachedText: async function (url, timeoutMs, cacheMs) {
    const cached = this.cache[url];
    const now = Date.now();

    if (cached && now - cached.timestamp < cacheMs) {
      return cached.text;
    }

    const text = await this.fetchText(url, timeoutMs);
    this.cache[url] = {
      text,
      timestamp: now
    };

    return text;
  },

  fetchText: function (url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const client = String(url).startsWith("https:") ? https : http;
      const request = client.get(url, {
        headers: {
          "User-Agent": "MMM-HAM-Display/0.1"
        },
        timeout: timeoutMs
      }, (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }

        response.setEncoding("utf8");
        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => resolve(body));
      });

      request.on("timeout", () => {
        request.destroy(new Error(`Timed out loading ${url}`));
      });

      request.on("error", reject);
    });
  }
});
