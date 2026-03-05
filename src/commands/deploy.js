import {
  getConfig,
  getAppConfig,
  pushAppConfig,
  getRegistryCredentials,
  uploadWorker,
  buildWorkerMetadata,
  getWorkersSubdomain,
  enableWorkerSubdomain,
  getDONamespaceId,
  findContainerApp,
  createContainerApp,
  modifyContainerApp,
  createRollout,
  CF_REGISTRY,
} from "../lib/cf.js";
import { dockerBuild, dockerTag, dockerPush, dockerLogin } from "../lib/docker.js";
import { createInterface } from "readline";
import { getWorkerBundle, templateHash } from "../lib/bundle.js";
import { randomBytes } from "crypto";
import { phase, status, success, hint, fatal, fmt, generateAppName } from "../lib/output.js";
import { readLink, readLinkImage, linkApp } from "../lib/link.js";

function buildContainerConfig(appConfig) {
  var cfg = {
    image: appConfig.image,
    observability: { logs: { enabled: appConfig.observability !== false } },
  };

  // Explicit resources take priority over instance_type
  if (appConfig.vcpu || appConfig.memory || appConfig.disk) {
    if (appConfig.vcpu) cfg.vcpu = appConfig.vcpu;
    if (appConfig.memory) cfg.memory_mib = appConfig.memory;
    if (appConfig.disk) cfg.disk = { size_mb: appConfig.disk };
  } else {
    cfg.instance_type = appConfig.instanceType || "lite";
  }

  return cfg;
}

var VALID_HINTS = [
  "wnam", "enam", "sam", "weur", "eeur", "apac", "oc", "afr", "me",
];

export async function deploy(nameOrPath, path, options) {
  var config = getConfig();

  // If first arg looks like a path, shift args and auto-generate name
  var name;
  var dockerPath;
  if (!nameOrPath) {
    // No args — use linked name or auto-generate
    name = readLink() || generateAppName();
    dockerPath = ".";
  } else if (nameOrPath.startsWith(".") || nameOrPath.startsWith("/") || nameOrPath.startsWith("~")) {
    // First arg is a path — use linked name or auto-generate
    name = readLink() || generateAppName();
    dockerPath = nameOrPath;
  } else {
    name = nameOrPath;
    dockerPath = path || ".";
  }

  var tag = options.tag || `${Date.now()}`;

  // Resolve prebuilt image: explicit --image flag > saved in .flarepilot.json
  var prebuiltImage = options.image || readLinkImage() || null;

  var localTag = prebuiltImage || `flarepilot-${name}:${tag}`;
  var remoteTag = `${CF_REGISTRY}/${config.accountId}/flarepilot-${name}:${tag}`;

  // Load existing config from deployed worker (null on first deploy)
  var appConfig;
  try {
    appConfig = await getAppConfig(config, name);
  } catch {
    appConfig = null;
  }

  var isFirstDeploy = !appConfig;

  if (appConfig) {
    // Existing app — update image, merge any flags
    appConfig.image = remoteTag;
    appConfig.deployedAt = new Date().toISOString();

    if (options.env) {
      if (!appConfig.envKeys) appConfig.envKeys = [];
      if (!appConfig.secretKeys) appConfig.secretKeys = [];
      if (!appConfig.env) appConfig.env = {};
      for (var v of options.env) {
        var eq = v.indexOf("=");
        if (eq !== -1) {
          var k = v.substring(0, eq);
          appConfig.env[k] = v.substring(eq + 1);
          // Deploy --env always sets plain_text; remove from secrets if present
          appConfig.secretKeys = appConfig.secretKeys.filter((s) => s !== k);
          if (!appConfig.envKeys.includes(k)) appConfig.envKeys.push(k);
        }
      }
    }
    if (options.regions)
      appConfig.regions = options.regions.split(",").map((r) => r.trim());
    if (options.instances) appConfig.instances = options.instances;
    if (options.port) appConfig.port = options.port;
    if (options.sleep) appConfig.sleepAfter = options.sleep;
    if (options.instanceType) appConfig.instanceType = options.instanceType;
    if (options.vcpu) appConfig.vcpu = options.vcpu;
    if (options.memory) appConfig.memory = options.memory;
    if (options.disk) appConfig.disk = options.disk;
    if (options.observability === false) appConfig.observability = false;
  } else {
    // First deploy — build config from flags + defaults
    var env = {};
    var envKeys = [];
    if (options.env) {
      for (var v of options.env) {
        var eq = v.indexOf("=");
        if (eq !== -1) {
          var k = v.substring(0, eq);
          env[k] = v.substring(eq + 1);
          envKeys.push(k);
        }
      }
    }

    var regions = options.regions
      ? options.regions.split(",").map((r) => r.trim())
      : ["enam"];

    for (var r of regions) {
      if (!VALID_HINTS.includes(r)) {
        fatal(
          `Invalid region '${r}'.`,
          `Valid regions: ${VALID_HINTS.join(", ")}`
        );
      }
    }

    appConfig = {
      name,
      regions,
      instances: options.instances || 2,
      port: options.port || 8080,
      sleepAfter: options.sleep || "30s",
      instanceType: options.instanceType || "lite",
      vcpu: options.vcpu || undefined,
      memory: options.memory || undefined,
      disk: options.disk || undefined,
      env,
      envKeys,
      secretKeys: [],
      domains: [],
      image: remoteTag,
      createdAt: new Date().toISOString(),
      deployedAt: new Date().toISOString(),
    };

  }

  // --- D1 database (--db flag) ---
  var newSecrets = {};
  if (options.db && !appConfig.dbId) {
    var { createD1Database } = await import("../lib/cf.js");
    var dbResult = await createD1Database(config, `flarepilot-${name}`, {
      locationHint: options.dbLocation,
      jurisdiction: options.dbJurisdiction,
    });
    appConfig.dbId = dbResult.uuid;
    appConfig.dbName = `flarepilot-${name}`;

    // Auto-provision DB_URL and DB_TOKEN env vars for the container
    if (!appConfig.envKeys) appConfig.envKeys = [];
    if (!appConfig.secretKeys) appConfig.secretKeys = [];
    if (!appConfig.env) appConfig.env = {};

    var subdomain = await getWorkersSubdomain(config);
    var dbUrl = subdomain
      ? `https://flarepilot-${name}.${subdomain}.workers.dev`
      : null;

    if (dbUrl) {
      appConfig.env["DB_URL"] = dbUrl;
      if (!appConfig.envKeys.includes("DB_URL")) appConfig.envKeys.push("DB_URL");
    }

    appConfig.env["DB_TOKEN"] = "[hidden]";
    appConfig.secretKeys = appConfig.secretKeys.filter((k) => k !== "DB_TOKEN");
    appConfig.secretKeys.push("DB_TOKEN");
    appConfig.envKeys = appConfig.envKeys.filter((k) => k !== "DB_TOKEN");

    newSecrets.DB_TOKEN = randomBytes(32).toString("hex");
  }

  // --- Summary & confirmation ---
  var instanceDesc = appConfig.vcpu
    ? `${appConfig.vcpu} vCPU, ${appConfig.memory || "default"} MiB`
    : appConfig.instanceType || "lite";

  process.stderr.write(`\n${fmt.bold("Deploy summary")}\n`);
  process.stderr.write(`${fmt.dim("─".repeat(40))}\n`);
  process.stderr.write(`  ${fmt.bold("App:")}        ${fmt.app(name)}${isFirstDeploy ? fmt.dim(" (new)") : ""}\n`);
  if (prebuiltImage) {
    process.stderr.write(`  ${fmt.bold("Source:")}     ${prebuiltImage} ${fmt.dim("(pre-built)")}\n`);
  } else {
    process.stderr.write(`  ${fmt.bold("Path:")}       ${dockerPath}\n`);
  }
  process.stderr.write(`  ${fmt.bold("Image:")}      ${remoteTag}\n`);
  process.stderr.write(`  ${fmt.bold("Regions:")}    ${appConfig.regions.join(", ")}\n`);
  process.stderr.write(`  ${fmt.bold("Instances:")}  ${appConfig.instances || 2} per region\n`);
  process.stderr.write(`  ${fmt.bold("Type:")}       ${instanceDesc}\n`);
  process.stderr.write(`  ${fmt.bold("Port:")}       ${appConfig.port || 8080}\n`);
  process.stderr.write(`  ${fmt.bold("Sleep:")}      ${appConfig.sleepAfter || "30s"}\n`);
  if (appConfig.dbId) {
    process.stderr.write(`  ${fmt.bold("Database:")}   ${appConfig.dbName}\n`);
  }
  process.stderr.write(`${fmt.dim("─".repeat(40))}\n`);

  if (!options.yes) {
    var rl = createInterface({ input: process.stdin, output: process.stderr });
    var answer = await new Promise((resolve) =>
      rl.question("\nProceed? [Y/n] ", resolve)
    );
    rl.close();
    if (answer && !answer.match(/^y(es)?$/i)) {
      process.stderr.write("Deploy cancelled.\n");
      process.exit(0);
    }
  }

  if (!prebuiltImage) {
    // 1. Build Docker image
    phase("Building image");
    status(`${localTag} for linux/amd64`);
    dockerBuild(dockerPath, localTag);
  }

  // 2. Push to Cloudflare Registry
  phase("Pushing to Cloudflare Registry");
  status("Authenticating with registry.cloudflare.com...");
  var creds = await getRegistryCredentials(config);
  dockerLogin(CF_REGISTRY, creds.username, creds.password);
  status(`Pushing ${remoteTag}...`);
  dockerTag(localTag, remoteTag);
  dockerPush(remoteTag);

  // 3. Deploy worker
  phase("Deploying worker");
  var scriptName = `flarepilot-${name}`;
  var currentHash = templateHash();
  var needsWorkerUpload = isFirstDeploy || appConfig.templateHash !== currentHash;

  if (needsWorkerUpload) {
    status("Bundling worker template...");
    var bundledCode = getWorkerBundle();
    appConfig.templateHash = currentHash;
    status(`Uploading ${scriptName}...`);
    var metadata = buildWorkerMetadata(appConfig, { firstDeploy: isFirstDeploy, newSecrets });
    await uploadWorker(config, scriptName, bundledCode, metadata);
  } else {
    status("Updating app config...");
    await pushAppConfig(config, name, appConfig, { newSecrets });
  }

  // 4. Deploy container application
  phase("Deploying container");

  status("Resolving DO namespace...");
  var namespaceId = await getDONamespaceId(config, scriptName, "AppContainer");
  if (!namespaceId) {
    fatal(
      "Could not find Durable Object namespace for AppContainer.",
      "The worker upload may have failed. Try again."
    );
  }

  var existingApp = await findContainerApp(config, scriptName);

  var maxInstances = (appConfig.regions?.length || 1) * (appConfig.instances || 2);

  if (existingApp) {
    // Update max_instances if changed
    if (existingApp.max_instances !== maxInstances) {
      status("Updating max instances...");
      await modifyContainerApp(config, existingApp.id, {
        max_instances: maxInstances,
      });
    }
    // Roll out new image + config
    status("Rolling out new version...");
    await createRollout(config, existingApp.id, {
      description: `Deploy ${remoteTag}`,
      strategy: "rolling",
      kind: "full_auto",
      step_percentage: 100,
      target_configuration: buildContainerConfig(appConfig),
    });
  } else {
    // Create new container app
    status("Creating container application...");
    await createContainerApp(config, {
      name: scriptName,
      scheduling_policy: "default",
      instances: 0,
      max_instances: maxInstances,
      configuration: buildContainerConfig(appConfig),
      durable_objects: {
        namespace_id: namespaceId,
      },
    });
  }

  // 5. Enable workers.dev route
  status("Enabling workers.dev subdomain...");
  try {
    await enableWorkerSubdomain(config, scriptName);
  } catch {}

  // 6. Resolve URL and report
  var subdomain = await getWorkersSubdomain(config);
  var url = subdomain
    ? `https://flarepilot-${name}.${subdomain}.workers.dev`
    : null;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          name,
          image: remoteTag,
          url,
          regions: appConfig.regions,
          instances: appConfig.instances,
          firstDeploy: isFirstDeploy,
        },
        null,
        2
      )
    );
  } else {
    success(`App ${fmt.app(name)} deployed!`);
    process.stderr.write(`  ${fmt.bold("Name:")}  ${fmt.app(name)}\n`);
    process.stderr.write(`  ${fmt.bold("Image:")} ${remoteTag}\n`);
    process.stderr.write(
      `  ${fmt.bold("URL:")}   ${url ? fmt.url(url) : fmt.dim("(configure workers.dev subdomain to see URL)")}\n`
    );
    hint("Next", `flarepilot open ${name}`);
  }

  // Link this directory to the app (persist prebuilt image for subsequent deploys)
  linkApp(name, prebuiltImage || undefined);
}
