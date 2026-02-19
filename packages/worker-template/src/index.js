import { Container } from "@cloudflare/containers";

// Map CF continent codes (from request.cf.continent) to preferred location hints
// Ordered by proximity — first match from app's configured regions wins
var CONTINENT_PREFERENCES = {
  NA: ["enam", "wnam", "sam"],
  SA: ["sam", "enam", "wnam"],
  EU: ["weur", "eeur", "me", "afr"],
  AS: ["apac", "me", "eeur"],
  OC: ["oc", "apac"],
  AF: ["afr", "me", "weur", "eeur"],
  AN: ["oc", "sam", "apac"],
};

/**
 * Pick the closest region from the app's deployed regions
 * based on the request's Cloudflare geo data.
 */
function pickRegion(regions, cf) {
  if (regions.length === 1) return regions[0];
  if (!cf || !cf.continent) return regions[0];

  var preferences = CONTINENT_PREFERENCES[cf.continent];
  if (!preferences) return regions[0];

  for (var hint of preferences) {
    if (regions.includes(hint)) return hint;
  }

  return regions[0];
}

export class AppContainer extends Container {
  enableInternet = true;

  constructor(ctx, env) {
    super(ctx, env);
    var appConfig = JSON.parse(env.FLAREPILOT_APP_CONFIG);
    this.sleepAfter = appConfig.sleepAfter || "30s";
  }

  async fetch(request) {
    var appConfig = JSON.parse(this.env.FLAREPILOT_APP_CONFIG);
    var port = appConfig.port || 8080;

    var state = await this.getState();
    if (state.status !== "running" && state.status !== "healthy") {
      await this.startAndWaitForPorts({
        startOptions: { envVars: appConfig.env || {} },
      });
    }

    return this.containerFetch(request, port);
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

    var response = await container.fetch(request);

    // Also set on response for external observability (curl -I, devtools)
    var headers = new Headers(response.headers);
    headers.set("X-Flarepilot-Region", region);
    headers.set("X-Flarepilot-Colo", cf.colo || "unknown");
    headers.set("X-Flarepilot-Continent", cf.continent || "unknown");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
