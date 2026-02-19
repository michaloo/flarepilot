import { createInterface } from "readline";
import {
  getConfig,
  getAppConfig,
  pushAppConfig,
  getWorkersSubdomain,
  listZones,
  findZoneForHostname,
  addWorkerDomain,
  removeWorkerDomain,
  listWorkerDomainsForService,
  listDnsRecords,
  createDnsRecord,
  deleteDnsRecord,
} from "../lib/cf.js";
import { phase, status, success, fatal, hint, fmt } from "../lib/output.js";
import { resolveAppName } from "../lib/link.js";
import kleur from "kleur";

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function domainsList(name, options) {
  name = resolveAppName(name);
  var config = getConfig();
  var scriptName = `flarepilot-${name}`;

  var subdomain = await getWorkersSubdomain(config);
  var defaultDomain = subdomain
    ? `flarepilot-${name}.${subdomain}.workers.dev`
    : null;

  // Get live domains from CF API
  var domains = await listWorkerDomainsForService(config, scriptName);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          default: defaultDomain,
          custom: domains.map((d) => d.hostname),
        },
        null,
        2
      )
    );
    return;
  }

  if (defaultDomain) {
    console.log(
      `\n${fmt.bold("Default:")} ${fmt.url(`https://${defaultDomain}`)}`
    );
  }

  if (domains.length === 0) {
    console.log(`${fmt.bold("Custom:")}  ${fmt.dim("(none)")}`);
    hint("Add", `flarepilot domains add ${name}`);
    return;
  }

  console.log(`\n${fmt.bold("Custom domains:")}`);
  for (var d of domains) {
    console.log(`  ${d.hostname}`);
  }
}

export async function domainsAdd(args) {
  var name, domain;

  // Parse args: 0 args = interactive, 1 arg = domain or name, 2 args = name + domain
  if (args.length === 2) {
    name = args[0];
    domain = args[1];
  } else if (args.length === 1) {
    // Could be a domain or just an app name — check if it looks like a domain
    if (args[0].includes(".")) {
      name = resolveAppName(null);
      domain = args[0];
    } else {
      name = args[0];
      domain = null;
    }
  } else {
    name = resolveAppName(null);
    domain = null;
  }

  var config = getConfig();
  var scriptName = `flarepilot-${name}`;

  var appConfig = await getAppConfig(config, name);
  if (!appConfig) {
    fatal(
      `App ${fmt.app(name)} not found.`,
      `Run ${fmt.cmd(`flarepilot deploy ${name} .`)} first.`
    );
  }

  // Fetch zones
  status("Loading zones...");
  var zones = await listZones(config);

  if (zones.length === 0) {
    fatal(
      "No active zones found in this account.",
      "Add a domain to your Cloudflare account first."
    );
  }

  var rl = createInterface({ input: process.stdin, output: process.stderr });
  var zone;

  if (domain) {
    // Domain provided — find matching zone
    zone = findZoneForHostname(zones, domain);
    if (!zone) {
      rl.close();
      var zoneList = zones.map((z) => `  ${z.name}`).join("\n");
      fatal(
        `No zone found for '${domain}'.`,
        `Available zones:\n${zoneList}`
      );
    }
  } else {
    // Interactive — pick zone
    process.stderr.write(`\n${kleur.bold("Available zones:")}\n\n`);
    for (var i = 0; i < zones.length; i++) {
      process.stderr.write(
        `  ${kleur.bold(`[${i + 1}]`)} ${zones[i].name}\n`
      );
    }
    process.stderr.write("\n");

    var zoneChoice = await prompt(rl, `Select zone [1-${zones.length}]: `);
    var zoneIdx = parseInt(zoneChoice, 10) - 1;
    if (isNaN(zoneIdx) || zoneIdx < 0 || zoneIdx >= zones.length) {
      rl.close();
      fatal("Invalid selection.");
    }
    zone = zones[zoneIdx];

    // Pick root or subdomain
    process.stderr.write(`\n${kleur.bold("Route type:")}\n\n`);
    process.stderr.write(`  ${kleur.bold("[1]")} Root domain (${zone.name})\n`);
    process.stderr.write(`  ${kleur.bold("[2]")} Subdomain (*.${zone.name})\n`);
    process.stderr.write("\n");

    var routeChoice = await prompt(rl, "Select [1-2]: ");

    if (routeChoice.trim() === "1") {
      domain = zone.name;
    } else if (routeChoice.trim() === "2") {
      var sub = await prompt(rl, `Subdomain: ${fmt.dim("___." + zone.name + " → ")} `);
      sub = (sub || "").trim();
      if (!sub) {
        rl.close();
        fatal("No subdomain provided.");
      }
      domain = `${sub}.${zone.name}`;
    } else {
      rl.close();
      fatal("Invalid selection.");
    }
  }

  rl.close();

  // Check for existing DNS records — never overwrite
  status(`Checking existing DNS records for ${domain}...`);
  var existing = await listDnsRecords(config, zone.id, { name: domain });

  if (existing.length > 0) {
    var types = existing.map((r) => `${r.type} → ${r.content}`).join("\n  ");
    fatal(
      `DNS record already exists for ${domain}.`,
      `Existing records:\n  ${types}\n\nRemove the existing record first, or choose a different domain.`
    );
  }

  // Attach domain to worker via CF API first (validates no external conflicts)
  status(`Attaching ${domain} to ${scriptName} (zone: ${zone.name})...`);
  try {
    await addWorkerDomain(config, scriptName, domain, zone.id);
  } catch (e) {
    if (e.message.includes("already has externally managed DNS records")) {
      fatal(
        `DNS record already exists for ${domain} (externally managed).`,
        "Remove the existing DNS record first, or choose a different domain."
      );
    }
    throw e;
  }

  // Create CNAME record pointing to workers.dev (only after domain is attached)
  var subdomain = await getWorkersSubdomain(config);
  var target = subdomain ? `flarepilot-${name}.${subdomain}.workers.dev` : null;

  if (target) {
    status(`Creating CNAME ${domain} → ${target}...`);
    try {
      await createDnsRecord(config, zone.id, {
        type: "CNAME",
        name: domain,
        content: target,
        proxied: true,
      });
    } catch (e) {
      // Not fatal — worker domain is already attached, CNAME is optional
      if (!e.message.includes("already exists")) {
        process.stderr.write(`  ${fmt.dim(`Warning: could not create CNAME: ${e.message}`)}\n`);
      }
    }
  }

  // Update app config metadata
  if (!appConfig.domains) appConfig.domains = [];
  if (!appConfig.domains.includes(domain)) {
    appConfig.domains.push(domain);
    await pushAppConfig(config, name, appConfig);
  }

  success(`Domain ${fmt.bold(domain)} added to ${fmt.app(name)}.`);
  process.stderr.write(`  ${fmt.url(`https://${domain}`)}\n`);
}

export async function domainsRemove(args) {
  // 1 arg = domain (resolve name from link). 2 args = name + domain.
  var name, domain;
  if (args.length === 2) {
    name = args[0];
    domain = args[1];
  } else if (args.length === 1) {
    name = resolveAppName(null);
    domain = args[0];
  } else {
    fatal("Usage: flarepilot domains remove [name] <domain>");
  }

  var config = getConfig();

  var appConfig = await getAppConfig(config, name);
  if (!appConfig) {
    fatal(
      `App ${fmt.app(name)} not found.`,
      `Run ${fmt.cmd(`flarepilot deploy ${name} .`)} first.`
    );
  }

  // Remove Worker Domain route
  status(`Removing ${domain}...`);
  await removeWorkerDomain(config, domain);

  // Remove CNAME record if it exists
  var zones = await listZones(config);
  var zone = findZoneForHostname(zones, domain);
  if (zone) {
    var records = await listDnsRecords(config, zone.id, {
      type: "CNAME",
      name: domain,
    });
    for (var record of records) {
      await deleteDnsRecord(config, zone.id, record.id);
    }
  }

  // Update app config metadata
  appConfig.domains = (appConfig.domains || []).filter((d) => d !== domain);
  await pushAppConfig(config, name, appConfig);

  success(`Domain ${fmt.bold(domain)} removed from ${fmt.app(name)}.`);
}
