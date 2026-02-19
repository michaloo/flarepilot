import {
  getConfig,
  getAppConfig,
  deleteWorker,
  listWorkerScripts,
  getWorkersSubdomain,
} from "../lib/cf.js";
import { success, fatal, hint, fmt, table } from "../lib/output.js";
import { resolveAppName } from "../lib/link.js";
import { createInterface } from "readline";

export async function appsList(options) {
  var config = getConfig();
  var scripts = await listWorkerScripts(config);
  var apps = scripts.filter((s) => s.id.startsWith("flarepilot-"));

  if (apps.length === 0) {
    if (options.json) {
      console.log("[]");
    } else {
      process.stderr.write("No apps deployed.\n");
      hint("Next", "flarepilot deploy");
    }
    return;
  }

  var data = apps.map((s) => ({
    name: s.id.replace("flarepilot-", ""),
    modified: s.modified_on || null,
  }));

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  var rows = data.map((a) => [
    fmt.app(a.name),
    a.modified ? new Date(a.modified).toISOString() : "—",
  ]);

  console.log(table(["NAME", "LAST MODIFIED"], rows));
}

export async function appsInfo(name, options) {
  name = resolveAppName(name);
  var config = getConfig();
  var appConfig = await getAppConfig(config, name);

  if (!appConfig) {
    fatal(
      `App ${fmt.app(name)} not found.`,
      `Run ${fmt.cmd(`flarepilot deploy ${name} .`)} first.`
    );
  }

  if (options.json) {
    console.log(JSON.stringify(appConfig, null, 2));
    return;
  }

  var subdomain = await getWorkersSubdomain(config);
  var url = subdomain
    ? `https://flarepilot-${name}.${subdomain}.workers.dev`
    : null;

  console.log("");
  console.log(`${fmt.bold("App:")}        ${fmt.app(name)}`);
  if (url) console.log(`${fmt.bold("URL:")}        ${fmt.url(url)}`);
  console.log(
    `${fmt.bold("Image:")}      ${appConfig.image || fmt.dim("(not deployed)")}`
  );
  console.log(`${fmt.bold("Regions:")}    ${appConfig.regions.join(", ")}`);
  console.log(`${fmt.bold("Instances:")}  ${appConfig.instances} per region`);
  console.log(`${fmt.bold("Port:")}       ${appConfig.port}`);
  console.log(
    `${fmt.bold("Domains:")}    ${(appConfig.domains || []).join(", ") || fmt.dim("(none)")}`
  );
  console.log(
    `${fmt.bold("Env vars:")}   ${Object.keys(appConfig.env || {}).length}`
  );
  if (appConfig.deployedAt) {
    console.log(`${fmt.bold("Deployed:")}   ${appConfig.deployedAt}`);
  }
  if (appConfig.createdAt) {
    console.log(`${fmt.bold("Created:")}    ${appConfig.createdAt}`);
  }
}

export async function appsDestroy(name, options) {
  name = resolveAppName(name);
  if (options.confirm !== name) {
    if (process.stdin.isTTY) {
      var rl = createInterface({ input: process.stdin, output: process.stderr });
      var answer = await new Promise((resolve) =>
        rl.question(`Type "${name}" to confirm destruction: `, resolve)
      );
      rl.close();
      if (answer.trim() !== name) {
        fatal("Confirmation did not match. Aborting.");
      }
    } else {
      fatal(
        `Destroying ${fmt.app(name)} requires confirmation.`,
        `Run: flarepilot apps destroy ${name} --confirm ${name}`
      );
    }
  }

  var config = getConfig();

  process.stderr.write(`Deleting worker flarepilot-${name}...\n`);
  try {
    await deleteWorker(config, `flarepilot-${name}`);
  } catch (e) {
    fatal(`Could not delete ${fmt.app(name)}.`, e.message);
  }

  success(`App ${fmt.app(name)} destroyed.`);
}
