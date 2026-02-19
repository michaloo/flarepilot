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
    hint("Add", `flarepilot domains add ${name} yourdomain.com`);
    return;
  }

  console.log(`\n${fmt.bold("Custom domains:")}`);
  for (var d of domains) {
    console.log(`  ${d.hostname}`);
  }
}

export async function domainsAdd(args) {
  // 1 arg = domain (resolve name from link). 2 args = name + domain.
  var name, domain;
  if (args.length === 2) {
    name = args[0];
    domain = args[1];
  } else if (args.length === 1) {
    name = resolveAppName(null);
    domain = args[0];
  } else {
    fatal("Usage: flarepilot domains add [name] <domain>");
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

  // Find the zone for this hostname
  status("Looking up zones...");
  var zones = await listZones(config);

  if (zones.length === 0) {
    fatal(
      "No active zones found in this account.",
      "Add a domain to your Cloudflare account first."
    );
  }

  var zone = findZoneForHostname(zones, domain);

  if (!zone) {
    var zoneList = zones.map((z) => `  ${z.name}`).join("\n");
    fatal(
      `No zone found for '${domain}'.`,
      `Available zones:\n${zoneList}`
    );
  }

  // Create CNAME record pointing to workers.dev
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
      // CNAME may already exist — not fatal
      if (!e.message.includes("already exists")) {
        fatal("Failed to create DNS record.", e.message);
      }
    }
  }

  // Attach domain to worker via CF API
  status(`Attaching ${domain} to flarepilot-${name} (zone: ${zone.name})...`);
  await addWorkerDomain(config, scriptName, domain, zone.id);

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
