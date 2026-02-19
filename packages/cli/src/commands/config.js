import { readFileSync } from "fs";
import { getConfig, getAppConfig, pushAppConfig } from "../lib/cf.js";
import { status, success, fatal, fmt } from "../lib/output.js";
import { resolveAppName } from "../lib/link.js";

export async function configShow(name, options) {
  name = resolveAppName(name);
  var config = getConfig();
  var appConfig = await getAppConfig(config, name);

  if (!appConfig) {
    fatal(
      `App ${fmt.app(name)} not found.`,
      `Run ${fmt.cmd(`flarepilot deploy ${name} .`)} first.`
    );
  }

  var env = appConfig.env || {};
  var keys = Object.keys(env);

  if (keys.length === 0) {
    if (options.json) {
      console.log("{}");
    } else {
      process.stderr.write(`No config vars set for ${fmt.app(name)}.\n`);
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(env, null, 2));
    return;
  }

  for (var key of keys) {
    console.log(`${fmt.key(key)}=${env[key]}`);
  }
}

export async function configSet(args) {
  // Smart detection: if first arg contains '=', all args are vars.
  // Otherwise first arg is the app name.
  var name, vars;
  if (args.length === 0) {
    fatal("No env vars provided.", "Usage: flarepilot config set [name] KEY=VALUE ...");
  }
  if (args[0].includes("=")) {
    name = resolveAppName(null);
    vars = args;
  } else {
    name = args[0];
    vars = args.slice(1);
  }

  if (vars.length === 0) {
    fatal("No env vars provided.", "Usage: flarepilot config set [name] KEY=VALUE ...");
  }

  var config = getConfig();
  var appConfig = await getAppConfig(config, name);

  if (!appConfig) {
    fatal(
      `App ${fmt.app(name)} not found.`,
      `Run ${fmt.cmd(`flarepilot deploy ${name} .`)} first.`
    );
  }

  if (!appConfig.env) appConfig.env = {};

  for (var v of vars) {
    var eq = v.indexOf("=");
    if (eq === -1) {
      fatal(`Invalid format: ${v}`, "Use KEY=VALUE format.");
    }
    var key = v.substring(0, eq);
    var value = v.substring(eq + 1);
    appConfig.env[key] = value;
    status(`${fmt.key(key)} set`);
  }

  await pushAppConfig(config, name, appConfig);
  success("Config updated (live).");
}

export async function configGet(args) {
  // 1 arg = key (resolve name from link). 2 args = name + key.
  var name, key;
  if (args.length === 2) {
    name = args[0];
    key = args[1];
  } else if (args.length === 1) {
    name = resolveAppName(null);
    key = args[0];
  } else {
    fatal("Usage: flarepilot config get [name] <key>");
  }

  var config = getConfig();
  var appConfig = await getAppConfig(config, name);

  if (!appConfig) {
    fatal(
      `App ${fmt.app(name)} not found.`,
      `Run ${fmt.cmd(`flarepilot deploy ${name} .`)} first.`
    );
  }

  var env = appConfig.env || {};

  if (!(key in env)) {
    fatal(`Key ${fmt.key(key)} is not set on ${fmt.app(name)}.`);
  }

  console.log(env[key]);
}

export async function configUnset(args) {
  // 1 arg = key (resolve name from link). 2+ args: if first looks like
  // an env key (UPPER_SNAKE), all are keys. Otherwise first is name.
  var name, keys;
  if (args.length === 0) {
    fatal("No keys provided.", "Usage: flarepilot config unset [name] KEY ...");
  }
  if (args.length === 1) {
    name = resolveAppName(null);
    keys = args;
  } else if (/^[A-Z_][A-Z0-9_]*$/.test(args[0])) {
    name = resolveAppName(null);
    keys = args;
  } else {
    name = args[0];
    keys = args.slice(1);
  }

  if (keys.length === 0) {
    fatal("No keys provided.", "Usage: flarepilot config unset [name] KEY ...");
  }

  var config = getConfig();
  var appConfig = await getAppConfig(config, name);

  if (!appConfig) {
    fatal(
      `App ${fmt.app(name)} not found.`,
      `Run ${fmt.cmd(`flarepilot deploy ${name} .`)} first.`
    );
  }

  if (!appConfig.env) appConfig.env = {};

  for (var key of keys) {
    if (!(key in appConfig.env)) {
      status(`${fmt.key(key)} ${fmt.dim("(not set, skipping)")}`);
      continue;
    }
    delete appConfig.env[key];
    status(`${fmt.key(key)} removed`);
  }

  await pushAppConfig(config, name, appConfig);
  success("Config updated (live).");
}

export async function configImport(name, options) {
  name = resolveAppName(name);
  var config = getConfig();
  var appConfig = await getAppConfig(config, name);

  if (!appConfig) {
    fatal(
      `App ${fmt.app(name)} not found.`,
      `Run ${fmt.cmd(`flarepilot deploy ${name} .`)} first.`
    );
  }

  if (!appConfig.env) appConfig.env = {};

  var input;
  if (options.file) {
    try {
      input = readFileSync(options.file, "utf-8");
    } catch (e) {
      fatal(`Could not read file: ${options.file}`, e.message);
    }
  } else if (process.stdin.isTTY) {
    fatal(
      "No input provided.",
      "Pipe a .env file: cat .env | flarepilot config import\n  Or use: flarepilot config import --file .env"
    );
  } else {
    var chunks = [];
    for await (var chunk of process.stdin) {
      chunks.push(chunk);
    }
    input = Buffer.concat(chunks).toString("utf-8");
  }

  var count = 0;
  for (var line of input.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    var eq = line.indexOf("=");
    if (eq === -1) continue;
    var key = line.substring(0, eq).trim();
    var value = line.substring(eq + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    appConfig.env[key] = value;
    status(`${fmt.key(key)} set`);
    count++;
  }

  if (count === 0) {
    fatal("No variables found in input.", "Use KEY=VALUE format, one per line.");
  }

  await pushAppConfig(config, name, appConfig);
  success(`${count} variable${count !== 1 ? "s" : ""} imported (live).`);
}
