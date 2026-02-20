#!/usr/bin/env node

import { Command } from "commander";
import { auth } from "./commands/auth.js";
import { appsList, appsInfo, appsDestroy } from "./commands/apps.js";
import { deploy } from "./commands/deploy.js";
import {
  configShow,
  configSet,
  configGet,
  configUnset,
  configImport,
} from "./commands/config.js";
import { scale } from "./commands/scale.js";
import { domainsList, domainsAdd, domainsRemove } from "./commands/domains.js";
import { ps } from "./commands/ps.js";
import { logs } from "./commands/logs.js";
import { open } from "./commands/open.js";
import { doctor } from "./commands/doctor.js";
import { cost } from "./commands/cost.js";
import { fmt } from "./lib/output.js";

var program = new Command();

program
  .name("flarepilot")
  .description("Deploy and manage apps on Cloudflare Containers")
  .version("0.2.0");

// --- Auth ---

program
  .command("auth")
  .description("Authenticate with your Cloudflare API token")
  .action(auth);

// --- Deploy ---

program
  .command("deploy [name] [path]")
  .description("Deploy an app from a Dockerfile (name auto-generated if omitted)")
  .option("-t, --tag <tag>", "Image tag (default: deploy-<timestamp>)")
  .option("-e, --env <vars...>", "Set env vars (KEY=VALUE)")
  .option(
    "--regions <hints>",
    "Comma-separated location hints (wnam,enam,sam,weur,eeur,apac,oc,afr,me)"
  )
  .option("-i, --instances <n>", "Instances per region", parseInt)
  .option("--port <port>", "Container port", parseInt)
  .option("--sleep <duration>", "Sleep after idle (e.g. 5m, 30s, never)", "30s")
  .option("--instance-type <type>", "Instance type (lite, base, standard, large)")
  .option("--vcpu <n>", "vCPU allocation (e.g. 0.0625, 0.5, 1, 2)", parseFloat)
  .option("--memory <mb>", "Memory in MiB (e.g. 256, 512, 1024)", parseInt)
  .option("--disk <mb>", "Disk in MB (e.g. 2000, 5000)", parseInt)
  .option("--no-observability", "Disable Workers observability/logs")
  .option("--json", "Output result as JSON")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(deploy);

// --- Apps (topic root = list) ---

var apps = program.command("apps").description("Manage apps");

apps
  .command("list", { isDefault: true })
  .description("List all deployed apps")
  .option("--json", "Output as JSON")
  .action(appsList);

apps
  .command("info [name]")
  .description("Show detailed app information")
  .option("--json", "Output as JSON")
  .action(appsInfo);

apps
  .command("destroy [name]")
  .description("Destroy an app and its resources")
  .option("--confirm <name>", "Confirm by providing the app name")
  .action(appsDestroy);

// --- Config (topic root = show) ---

var configCmd = program
  .command("config")
  .description("Manage app config/env vars");

configCmd
  .command("show [name]", { isDefault: true })
  .description("Show all env vars for an app")
  .option("--json", "Output as JSON")
  .action(configShow);

configCmd
  .command("set <args...>")
  .description("Set env vars ([name] KEY=VALUE ...) — applies live")
  .action(configSet);

configCmd
  .command("get <args...>")
  .description("Get a single env var value ([name] KEY)")
  .action(configGet);

configCmd
  .command("unset <args...>")
  .description("Remove env vars ([name] KEY ...) — applies live")
  .action(configUnset);

configCmd
  .command("import [name]")
  .description("Import env vars from .env file or stdin")
  .option("-f, --file <path>", "Path to .env file")
  .action(configImport);

// --- Scale ---

program
  .command("scale [name]")
  .description("Show or adjust app scaling")
  .option(
    "-r, --regions <hints>",
    "Comma-separated location hints (wnam,enam,sam,weur,eeur,apac,oc,afr,me)"
  )
  .option("-i, --instances <n>", "Instances per region", parseInt)
  .option("--instance-type <type>", "Instance type (lite, base, standard, large)")
  .option("--vcpu <n>", "vCPU allocation (e.g. 0.0625, 0.5, 1, 2)", parseFloat)
  .option("--memory <mb>", "Memory in MiB (e.g. 256, 512, 1024)", parseInt)
  .option("--disk <mb>", "Disk in MB (e.g. 2000, 5000)", parseInt)
  .option("--json", "Output as JSON")
  .action(scale);

// --- Domains (topic root = list) ---

var domainsCmd = program
  .command("domains")
  .description("Manage custom domains");

domainsCmd
  .command("list [name]", { isDefault: true })
  .description("List custom domains for an app")
  .option("--json", "Output as JSON")
  .action(domainsList);

domainsCmd
  .command("add [args...]")
  .description("Add a custom domain (interactive if no domain given)")
  .action(domainsAdd);

domainsCmd
  .command("remove <args...>")
  .description("Remove a custom domain ([name] domain) — applies live")
  .action(domainsRemove);

// --- PS ---

program
  .command("ps [name]")
  .description("Show app containers and status")
  .option("--json", "Output as JSON")
  .action(ps);

// --- Logs ---

program
  .command("logs [name]")
  .description("Stream live logs from an app")
  .action(logs);

// --- Open ---

program
  .command("open [name]")
  .description("Open app in browser")
  .action(open);

// --- Regions ---

program
  .command("regions")
  .description("List available deployment regions")
  .option("--json", "Output as JSON")
  .action(function (options) {
    var regions = [
      { code: "wnam", name: "Western North America", location: "Los Angeles, Seattle, San Francisco" },
      { code: "enam", name: "Eastern North America", location: "New York, Chicago, Toronto" },
      { code: "sam", name: "South America", location: "São Paulo, Buenos Aires" },
      { code: "weur", name: "Western Europe", location: "London, Paris, Amsterdam, Frankfurt" },
      { code: "eeur", name: "Eastern Europe", location: "Warsaw, Helsinki, Bucharest" },
      { code: "apac", name: "Asia Pacific", location: "Tokyo, Singapore, Hong Kong, Mumbai" },
      { code: "oc", name: "Oceania", location: "Sydney, Auckland" },
      { code: "afr", name: "Africa", location: "Johannesburg, Nairobi" },
      { code: "me", name: "Middle East", location: "Dubai, Bahrain" },
    ];
    if (options.json) {
      console.log(JSON.stringify(regions, null, 2));
      return;
    }
    console.log("");
    for (var r of regions) {
      console.log(`  ${fmt.bold(r.code.padEnd(6))} ${r.name.padEnd(25)} ${fmt.dim(r.location)}`);
    }
    console.log("");
    console.log(fmt.dim("  These are Durable Object locationHints. Cloudflare will attempt"));
    console.log(fmt.dim("  to place containers near the specified region but exact placement"));
    console.log(fmt.dim("  is not guaranteed."));
    console.log("");
  });

// --- Cost ---

program
  .command("cost [name]")
  .description("Show estimated costs for an app or all apps")
  .option("--since <period>", "Date range: Nd (e.g. 7d) or YYYY-MM-DD (default: month to date)")
  .option("--json", "Output as JSON")
  .action(cost);

// --- Doctor ---

program
  .command("doctor")
  .description("Check system setup and connectivity")
  .action(doctor);

// --- Top-level aliases ---

program
  .command("destroy [name]")
  .description("Destroy an app (alias for apps destroy)")
  .option("--confirm <name>", "Confirm by providing the app name")
  .action(appsDestroy);

program.parse();
