import {
  getConfig,
  getAppConfig,
  listWorkerScripts,
  listContainerApps,
  getDONamespaceId,
  cfGraphQL,
} from "../lib/cf.js";
import { phase, status, fatal, fmt, table } from "../lib/output.js";
import { resolveAppName } from "../lib/link.js";

// --- Pricing (Workers Paid plan, $5/mo) ---

var PRICING = {
  workerRequests: { included: 10_000_000, rate: 0.30 / 1_000_000 },
  workerCpuMs: { included: 30_000_000, rate: 0.02 / 1_000_000 },
  doRequests: { included: 1_000_000, rate: 0.15 / 1_000_000 },
  doGbSeconds: { included: 400_000, rate: 12.50 / 1_000_000 },
  containerVcpuSec: { included: 375 * 60, rate: 0.000020 },
  containerMemGibSec: { included: 25 * 3600, rate: 0.0000025 },
  containerDiskGbSec: { included: 200 * 3600, rate: 0.00000007 },
  containerEgressGb: { included: 0, rate: 0.025 },
  platform: 5.0,
};

// --- Date range parsing ---

function parseDateRange(since) {
  var now = new Date();
  var until = now;
  var start;

  if (!since) {
    // Default: 1st of current month
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (/^\d+d$/.test(since)) {
    var days = parseInt(since);
    start = new Date(now.getTime() - days * 86400_000);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    start = new Date(since + "T00:00:00Z");
    if (isNaN(start.getTime())) {
      fatal(`Invalid date: ${since}`, "Use YYYY-MM-DD or Nd (e.g. 7d)");
    }
  } else {
    fatal(
      `Invalid --since value: ${since}`,
      "Use YYYY-MM-DD or Nd (e.g. 7d, 30d)"
    );
  }

  var sinceISO = start.toISOString().slice(0, 19) + "Z";
  var untilISO = until.toISOString().slice(0, 19) + "Z";

  var label = formatDateRange(start, until);
  return { sinceISO, untilISO, sinceDate: start, untilDate: until, label };
}

function formatDateRange(start, end) {
  var opts = { month: "short", day: "numeric" };
  var s = start.toLocaleDateString("en-US", opts);
  var e = end.toLocaleDateString("en-US", opts);
  return `${s} – ${e}`;
}

// --- GraphQL query strings ---

var workersGQL = `query Workers($accountTag: string!, $filter: WorkersInvocationsAdaptiveFilter_InputObject!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 10000, filter: $filter) {
        dimensions { scriptName }
        sum { requests cpuTimeUs }
        avg { sampleInterval }
      }
    }
  }
}`;

var doRequestsGQL = `query DORequests($accountTag: string!, $filter: DurableObjectsInvocationsAdaptiveGroupsFilter_InputObject!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: $filter) {
        dimensions { namespaceId }
        sum { requests }
        avg { sampleInterval }
      }
    }
  }
}`;

var doDurationGQL = `query DODuration($accountTag: string!, $filter: DurableObjectsPeriodicGroupsFilter_InputObject!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      durableObjectsPeriodicGroups(limit: 10000, filter: $filter) {
        dimensions { namespaceId }
        sum { activeTime inboundWebsocketMsgCount }
      }
    }
  }
}`;

var containersGQL = `query Containers($accountTag: string!, $filter: AccountContainersMetricsAdaptiveGroupsFilter_InputObject!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      containersMetricsAdaptiveGroups(limit: 10000, filter: $filter) {
        dimensions { applicationId }
        sum { cpuTimeSec allocatedMemory allocatedDisk txBytes }
      }
    }
  }
}`;

// --- Aggregate raw GraphQL results per app ---

function aggregateResults(apps, analytics) {
  var { workersData, doReqData, doDurData, containersData } = analytics;

  // Index workers data by scriptName
  var workerRows =
    workersData?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
  var workersByScript = {};
  for (var row of workerRows) {
    var sn = row.dimensions.scriptName;
    var si = row.avg?.sampleInterval || 1;
    if (!workersByScript[sn]) workersByScript[sn] = { requests: 0, cpuMs: 0 };
    workersByScript[sn].requests += (row.sum?.requests || 0) * si;
    workersByScript[sn].cpuMs += ((row.sum?.cpuTimeUs || 0) / 1000) * si;
  }

  // Index DO requests by namespaceId
  var doReqRows =
    doReqData?.viewer?.accounts?.[0]?.durableObjectsInvocationsAdaptiveGroups || [];
  var doReqByNs = {};
  for (var row of doReqRows) {
    var ns = row.dimensions.namespaceId;
    var si = row.avg?.sampleInterval || 1;
    if (!doReqByNs[ns]) doReqByNs[ns] = 0;
    doReqByNs[ns] += (row.sum?.requests || 0) * si;
  }

  // Index DO duration by namespaceId
  var doDurRows =
    doDurData?.viewer?.accounts?.[0]?.durableObjectsPeriodicGroups || [];
  var doDurByNs = {};
  for (var row of doDurRows) {
    var ns = row.dimensions.namespaceId;
    if (!doDurByNs[ns]) doDurByNs[ns] = { activeTime: 0, wsInbound: 0 };
    doDurByNs[ns].activeTime += row.sum?.activeTime || 0;
    doDurByNs[ns].wsInbound += row.sum?.inboundWebsocketMsgCount || 0;
  }

  // Index container metrics by applicationId
  var containerRows =
    containersData?.viewer?.accounts?.[0]?.containersMetricsAdaptiveGroups || [];
  var containersByAppId = {};
  for (var row of containerRows) {
    var appId = row.dimensions.applicationId;
    if (!containersByAppId[appId]) {
      containersByAppId[appId] = { cpuTimeSec: 0, allocatedMemory: 0, allocatedDisk: 0, txBytes: 0 };
    }
    containersByAppId[appId].cpuTimeSec += row.sum?.cpuTimeSec || 0;
    containersByAppId[appId].allocatedMemory += row.sum?.allocatedMemory || 0;
    containersByAppId[appId].allocatedDisk += row.sum?.allocatedDisk || 0;
    containersByAppId[appId].txBytes += row.sum?.txBytes || 0;
  }

  // Build per-app usage
  return apps.map((app) => {
    var scriptName = `flarepilot-${app.name}`;
    var w = workersByScript[scriptName] || { requests: 0, cpuMs: 0 };
    var nsId = app.namespaceId;

    var doDuration = nsId ? doDurByNs[nsId] || {} : {};
    // Billable DO requests = HTTP invocations + inbound WS messages at 20:1 ratio
    var doRequests = (nsId ? doReqByNs[nsId] || 0 : 0) + (doDuration.wsInbound || 0) / 20;

    // Real container metrics from containersMetricsAdaptiveGroups
    var c = app.containerAppId ? containersByAppId[app.containerAppId] || {} : {};
    var containerVcpuSec = c.cpuTimeSec || 0;
    // allocatedMemory is in byte-seconds → convert to GiB-seconds
    var containerMemGibSec = (c.allocatedMemory || 0) / (1024 * 1024 * 1024);
    // allocatedDisk is in byte-seconds → convert to GB-seconds
    var containerDiskGbSec = (c.allocatedDisk || 0) / 1_000_000_000;
    // txBytes → GB
    var containerEgressGb = (c.txBytes || 0) / 1_000_000_000;

    return {
      name: app.name,
      usage: {
        workerRequests: Math.round(w.requests),
        workerCpuMs: Math.round(w.cpuMs),
        doRequests: Math.round(doRequests),
        doWsMsgs: Math.round(doDuration.wsInbound || 0),
        doGbSeconds: Math.round(((doDuration.activeTime || 0) / 1_000_000) * 128 / 1024), // activeTime is µs, 128MiB DO memory → GB-s
        containerVcpuSec,
        containerMemGibSec,
        containerDiskGbSec,
        containerEgressGb,
      },
    };
  });
}

// --- Cost calculation ---

function calculateAppCosts(usage) {
  return {
    workerRequests: usage.workerRequests * PRICING.workerRequests.rate,
    workerCpuMs: usage.workerCpuMs * PRICING.workerCpuMs.rate,
    doRequests: usage.doRequests * PRICING.doRequests.rate,
    doGbSeconds: usage.doGbSeconds * PRICING.doGbSeconds.rate,
    containerVcpuSec: usage.containerVcpuSec * PRICING.containerVcpuSec.rate,
    containerMemGibSec: usage.containerMemGibSec * PRICING.containerMemGibSec.rate,
    containerDiskGbSec: usage.containerDiskGbSec * PRICING.containerDiskGbSec.rate,
    containerEgressGb: usage.containerEgressGb * PRICING.containerEgressGb.rate,
  };
}

function applyFreeTier(appResults) {
  // Sum gross usage fleet-wide
  var totals = {
    workerRequests: 0,
    workerCpuMs: 0,
    doRequests: 0,
    doGbSeconds: 0,
    containerVcpuSec: 0,
    containerMemGibSec: 0,
    containerDiskGbSec: 0,
    containerEgressGb: 0,
  };
  for (var app of appResults) {
    for (var key of Object.keys(totals)) {
      totals[key] += app.usage[key];
    }
  }

  // Calculate fleet-wide overage costs (usage beyond free tier)
  var fleetOverage = {};
  for (var key of Object.keys(totals)) {
    var included = PRICING[key].included;
    var overageUsage = Math.max(0, totals[key] - included);
    fleetOverage[key] = overageUsage * PRICING[key].rate;
  }

  // Gross fleet total
  var grossFleetTotal = 0;
  for (var app of appResults) {
    var costs = calculateAppCosts(app.usage);
    app.grossCosts = costs;
    var appGross = Object.values(costs).reduce((a, b) => a + b, 0);
    app.grossTotal = appGross;
    grossFleetTotal += appGross;
  }

  // Net fleet total (after free tier)
  var netFleetTotal = Object.values(fleetOverage).reduce((a, b) => a + b, 0);
  var freeTierDiscount = grossFleetTotal - netFleetTotal;

  // Distribute discount proportionally
  for (var app of appResults) {
    if (grossFleetTotal > 0) {
      var share = app.grossTotal / grossFleetTotal;
      app.freeTierDiscount = freeTierDiscount * share;
    } else {
      app.freeTierDiscount = 0;
    }
    app.netTotal = Math.max(0, app.grossTotal - app.freeTierDiscount);

    // Categorize costs for display
    app.workersCost = app.grossCosts.workerRequests + app.grossCosts.workerCpuMs;
    app.doCost = app.grossCosts.doRequests + app.grossCosts.doGbSeconds;
    app.containerCost =
      app.grossCosts.containerVcpuSec +
      app.grossCosts.containerMemGibSec +
      app.grossCosts.containerDiskGbSec +
      app.grossCosts.containerEgressGb;
  }

  return { appResults, freeTierDiscount, netFleetTotal, grossFleetTotal };
}

// --- Formatting helpers ---

function fmtCost(n) {
  return "$" + n.toFixed(2);
}

function fmtUsage(n, unit) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M " + unit;
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K " + unit;
  return n.toLocaleString("en-US") + " " + unit;
}

function fmtDuration(seconds) {
  var hrs = seconds / 3600;
  if (hrs >= 1) return hrs.toFixed(1) + " vCPU-hrs";
  var mins = seconds / 60;
  return mins.toFixed(1) + " vCPU-min";
}

function fmtGibHours(gibSec) {
  var hrs = gibSec / 3600;
  if (hrs >= 1) return hrs.toFixed(1) + " GiB-hrs";
  var mins = gibSec / 60;
  return mins.toFixed(1) + " GiB-min";
}

function fmtGbHours(gbSec) {
  var hrs = gbSec / 3600;
  if (hrs >= 1) return hrs.toFixed(1) + " GB-hrs";
  var mins = gbSec / 60;
  return mins.toFixed(1) + " GB-min";
}

// --- Render single app ---

function renderSingleApp(app, range) {
  console.log("");
  console.log(
    `  ${fmt.bold("Estimated cost for")} ${fmt.app(app.name)} ${fmt.dim(`(${range.label})`)}`
  );
  console.log("");

  var header = "  COMPONENT      USAGE                 ESTIMATED COST";
  var sep = "  " + "─".repeat(50);

  console.log(fmt.bold(header));
  console.log(fmt.dim(sep));

  var rows = [
    ["Workers", fmtUsage(app.usage.workerRequests, "requests"), fmtCost(app.grossCosts.workerRequests)],
    ["", fmtUsage(app.usage.workerCpuMs, "CPU-ms"), fmtCost(app.grossCosts.workerCpuMs)],
    ["Durable Obj", fmtUsage(app.usage.doRequests, "requests"), fmtCost(app.grossCosts.doRequests)],
    app.usage.doWsMsgs > 0
      ? ["", fmtUsage(app.usage.doWsMsgs, "WS msgs") + fmt.dim(" (20:1)"), ""]
      : null,
    ["", fmtUsage(app.usage.doGbSeconds, "GB-s"), fmtCost(app.grossCosts.doGbSeconds)],
    ["Containers", fmtDuration(app.usage.containerVcpuSec), fmtCost(app.grossCosts.containerVcpuSec)],
    ["", fmtGibHours(app.usage.containerMemGibSec) + " mem", fmtCost(app.grossCosts.containerMemGibSec)],
    ["", fmtGbHours(app.usage.containerDiskGbSec) + " disk", fmtCost(app.grossCosts.containerDiskGbSec)],
    ["", fmtUsage(app.usage.containerEgressGb, "GB egress"), fmtCost(app.grossCosts.containerEgressGb)],
  ];

  for (var row of rows.filter(Boolean)) {
    var comp = row[0] ? fmt.bold(row[0].padEnd(14)) : " ".repeat(14);
    var usage = row[1].padEnd(22);
    console.log(`  ${comp} ${usage} ${row[2]}`);
  }

  console.log(fmt.dim(sep));
  console.log(
    `  ${" ".repeat(14)} ${"".padEnd(22)} ${fmt.bold(fmtCost(app.grossTotal))}`
  );

  if (app.freeTierDiscount > 0) {
    console.log(
      `  ${" ".repeat(14)} ${fmt.dim("Free tier".padEnd(22))} ${fmt.dim("-" + fmtCost(app.freeTierDiscount))}`
    );
    console.log(
      `  ${" ".repeat(14)} ${fmt.bold("Net".padEnd(22))} ${fmt.bold(fmtCost(app.netTotal))}`
    );
  }

  console.log("");
  console.log(fmt.dim("  Estimates based on Cloudflare Workers Paid plan pricing."));
  console.log("");
}

// --- Render fleet ---

function renderFleet(fleet, range) {
  console.log("");
  console.log(
    `  ${fmt.bold("Estimated costs")} ${fmt.dim(`(${range.label})`)}`
  );
  console.log("");

  var headers = ["NAME", "WORKERS", "DO", "CONTAINERS", "TOTAL"];
  var rows = fleet.appResults.map((a) => [
    fmt.app(a.name),
    fmtCost(a.workersCost),
    fmtCost(a.doCost),
    fmtCost(a.containerCost),
    fmtCost(a.grossTotal),
  ]);

  console.log(table(headers, rows));
  console.log("");

  var labelW = 44;
  console.log(
    "  " + fmt.dim("Subtotal".padEnd(labelW)) + fmtCost(fleet.grossFleetTotal)
  );
  if (fleet.freeTierDiscount > 0) {
    console.log(
      "  " +
        fmt.dim("Free tier".padEnd(labelW)) +
        fmt.dim("-" + fmtCost(fleet.freeTierDiscount))
    );
  }
  console.log(
    "  " + fmt.dim("Platform".padEnd(labelW)) + fmtCost(PRICING.platform)
  );
  console.log("  " + fmt.dim("─".repeat(labelW + 8)));
  console.log(
    "  " +
      fmt.bold("TOTAL".padEnd(labelW)) +
      fmt.bold(fmtCost(fleet.netFleetTotal + PRICING.platform))
  );
  console.log("");
  console.log(fmt.dim("  Estimates based on Cloudflare Workers Paid plan pricing."));
  console.log("");
}

// --- Main command ---

export async function cost(name, options) {
  var config = getConfig();
  var range = parseDateRange(options.since);

  // Discover apps and container applications in parallel
  var [allScripts, containerApps] = await Promise.all([
    listWorkerScripts(config),
    listContainerApps(config),
  ]);
  var fpScripts = allScripts.filter((s) => s.id.startsWith("flarepilot-"));

  if (fpScripts.length === 0) {
    fatal(
      "No apps deployed.",
      `Run ${fmt.cmd("flarepilot deploy")} to deploy your first app.`
    );
  }

  // Build containerAppId lookup: "flarepilot-{name}" → applicationId
  var containerAppMap = {};
  for (var ca of containerApps) {
    containerAppMap[ca.name] = ca.id;
  }

  var singleApp = name ? resolveAppName(name) : null;

  if (singleApp) {
    if (!fpScripts.find((s) => s.id === `flarepilot-${singleApp}`)) {
      fatal(`App ${fmt.app(singleApp)} not found.`);
    }
  }

  phase("Fetching analytics");

  // Build app list with namespace IDs and configs
  var targetScripts = singleApp
    ? fpScripts.filter((s) => s.id === `flarepilot-${singleApp}`)
    : fpScripts;

  var apps = [];
  await Promise.all(
    targetScripts.map(async (s) => {
      var appName = s.id.replace(/^flarepilot-/, "");
      var [nsId, appConfig] = await Promise.all([
        getDONamespaceId(config, s.id, "AppContainer"),
        getAppConfig(config, appName),
      ]);
      apps.push({
        name: appName,
        namespaceId: nsId,
        appConfig,
        containerAppId: containerAppMap[s.id] || null,
      });
    })
  );

  apps.sort((a, b) => a.name.localeCompare(b.name));

  status(`Querying ${apps.length} app${apps.length > 1 ? "s" : ""}...`);

  // Fetch all analytics in parallel
  var scriptNames = apps.map((a) => `flarepilot-${a.name}`);
  var namespaceIds = apps.map((a) => a.namespaceId).filter(Boolean);
  var containerAppIds = apps.map((a) => a.containerAppId).filter(Boolean);

  var queries = [];

  // 1. Workers
  queries.push(
    cfGraphQL(config, workersGQL, {
      accountTag: config.accountId,
      filter: {
        datetimeHour_geq: range.sinceISO,
        datetimeHour_leq: range.untilISO,
        scriptName_in: scriptNames,
      },
    })
  );

  // 2-4. DO queries
  if (namespaceIds.length > 0) {
    var doFilter = {
      datetimeHour_geq: range.sinceISO,
      datetimeHour_leq: range.untilISO,
      namespaceId_in: namespaceIds,
    };
    queries.push(
      cfGraphQL(config, doRequestsGQL, { accountTag: config.accountId, filter: doFilter })
    );
    queries.push(
      cfGraphQL(config, doDurationGQL, { accountTag: config.accountId, filter: doFilter })
    );
  } else {
    queries.push(Promise.resolve(null), Promise.resolve(null));
  }

  // 5. Container metrics
  if (containerAppIds.length > 0) {
    queries.push(
      cfGraphQL(config, containersGQL, {
        accountTag: config.accountId,
        filter: {
          datetimeHour_geq: range.sinceISO,
          datetimeHour_leq: range.untilISO,
          applicationId_in: containerAppIds,
        },
      })
    );
  } else {
    queries.push(Promise.resolve(null));
  }

  var [workersData, doReqData, doDurData, containersData] =
    await Promise.all(queries);
  var analytics = { workersData, doReqData, doDurData, containersData };

  // Aggregate and calculate costs
  var appResults = aggregateResults(apps, analytics);
  var fleet = applyFreeTier(appResults);

  // Output
  if (options.json) {
    var jsonOut = singleApp
      ? {
          app: fleet.appResults[0].name,
          period: range.label,
          since: range.sinceISO,
          until: range.untilISO,
          usage: fleet.appResults[0].usage,
          costs: fleet.appResults[0].grossCosts,
          grossTotal: fleet.appResults[0].grossTotal,
          freeTierDiscount: fleet.appResults[0].freeTierDiscount,
          netTotal: fleet.appResults[0].netTotal,
        }
      : {
          period: range.label,
          since: range.sinceISO,
          until: range.untilISO,
          apps: fleet.appResults.map((a) => ({
            name: a.name,
            usage: a.usage,
            costs: a.grossCosts,
            grossTotal: a.grossTotal,
            freeTierDiscount: a.freeTierDiscount,
            netTotal: a.netTotal,
          })),
          grossFleetTotal: fleet.grossFleetTotal,
          freeTierDiscount: fleet.freeTierDiscount,
          netFleetTotal: fleet.netFleetTotal,
          platform: PRICING.platform,
          total: fleet.netFleetTotal + PRICING.platform,
        };
    console.log(JSON.stringify(jsonOut, null, 2));
    return;
  }

  if (singleApp) {
    renderSingleApp(fleet.appResults[0], range);
  } else {
    renderFleet(fleet, range);
  }
}
