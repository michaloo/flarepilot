import { Container } from "@cloudflare/containers";

export class AppContainer extends Container {
  enableInternet = true;

  constructor(ctx, env) {
    super(ctx, env);
    var appConfig = JSON.parse(env.FLAREPILOT_APP_CONFIG);
    this.defaultPort = appConfig.port || 8080;
    this.sleepAfter = appConfig.sleepAfter || "30s";
  }
}

export default {
  async fetch(request, env) {
    var appConfig = JSON.parse(env.FLAREPILOT_APP_CONFIG);

    var regions = appConfig.regions;
    var instances = appConfig.instances || 2;

    // Geo-aware routing: use Cloudflare's request.cf to pick closest region
    var cf = request.cf || {};
    var region = pickRegion(regions, cf);

    var binding = env.APP_CONTAINER;

    // Route to a random instance in the selected region
    var idx = Math.floor(Math.random() * instances);
    var objectId = binding.idFromName(region + "-" + idx);
    var container = binding.get(objectId, { locationHint: region });

    var response = await container.containerFetch(request);

    // Also set on response for external observability (curl -I, devtools)
    var headers = new Headers(response.headers);
    headers.set("X-Flarepilot-Region", region);

    return response;
  },
};


// Country → preferred location hints (ordered by proximity)
// Uses request.cf.country (ISO 3166-1 alpha-2)
var COUNTRY_PREFERENCES = {
  // Eastern Europe → eeur first
  PL: ["eeur", "weur"], CZ: ["eeur", "weur"], SK: ["eeur", "weur"],
  HU: ["eeur", "weur"], RO: ["eeur", "weur"], BG: ["eeur", "weur"],
  UA: ["eeur", "weur"], LT: ["eeur", "weur"], LV: ["eeur", "weur"],
  EE: ["eeur", "weur"], HR: ["eeur", "weur"], SI: ["eeur", "weur"],
  RS: ["eeur", "weur"], BA: ["eeur", "weur"], MK: ["eeur", "weur"],
  AL: ["eeur", "weur"], ME: ["eeur", "weur"], MD: ["eeur", "weur"],
  BY: ["eeur", "weur"], FI: ["eeur", "weur"], GR: ["eeur", "weur", "me"],
  // Turkey — between eeur and me
  TR: ["eeur", "me", "weur"],
  // Middle East (CF puts these in AS continent)
  AE: ["me", "eeur", "apac"], SA: ["me", "afr", "eeur"],
  QA: ["me", "eeur", "apac"], BH: ["me", "eeur", "apac"],
  KW: ["me", "eeur"], OM: ["me", "apac"], IL: ["me", "eeur"],
  JO: ["me", "eeur"], LB: ["me", "eeur"], IQ: ["me", "eeur"],
  IR: ["me", "apac", "eeur"], YE: ["me", "afr"],
  // South Asia → apac, but me as second choice
  IN: ["apac", "me"], PK: ["apac", "me"], BD: ["apac", "me"],
  LK: ["apac", "me"],
  // North Africa — closer to Europe/ME than sub-Saharan Africa
  EG: ["me", "eeur", "afr"], LY: ["afr", "me", "weur"],
  TN: ["afr", "weur", "me"], DZ: ["afr", "weur"],
  MA: ["afr", "weur"],
  // Mexico / Central America → wnam
  MX: ["wnam", "enam", "sam"],
  // Australia / NZ → explicit oc
  AU: ["oc", "apac"], NZ: ["oc", "apac"],
};

// Fallback: continent → preferred location hints
var CONTINENT_PREFERENCES = {
  NA: ["enam", "wnam", "sam"],
  SA: ["sam", "enam", "wnam"],
  EU: ["weur", "eeur"],
  AS: ["apac", "me", "eeur"],
  OC: ["oc", "apac"],
  AF: ["afr", "me", "weur"],
  AN: ["oc", "sam", "apac"],
};

/**
 * Pick the closest region from the app's deployed regions.
 * Checks country first (request.cf.country), falls back to continent.
 */
function pickRegion(regions, cf) {
  if (regions.length === 1) return regions[0];
  if (!cf) return regions[0];

  // try country-level match first
  var preferences = COUNTRY_PREFERENCES[cf.country] || CONTINENT_PREFERENCES[cf.continent];
  if (!preferences) return regions[0];

  for (var hint of preferences) {
    if (regions.includes(hint)) return hint;
  }

  return regions[0];
}