import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  cfApi,
  tryGetConfig,
  getWorkersSubdomain,
  getRegistryCredentials,
} from "../lib/cf.js";
import kleur from "kleur";

var CONFIG_PATH = join(homedir(), ".flarepilot", "config.json");

var PASS = kleur.green("[ok]");
var FAIL = kleur.red("[!!]");

export async function doctor() {
  process.stderr.write(`\n${kleur.bold("flarepilot doctor")}\n`);
  process.stderr.write(`${kleur.dim("─".repeat(40))}\n\n`);
  var allGood = true;

  allGood =
    check("Docker installed", () => {
      execSync("docker --version", { stdio: "pipe" });
    }) && allGood;

  allGood =
    check("Docker daemon running", () => {
      execSync("docker info", { stdio: "pipe", timeout: 5000 });
    }) && allGood;

  allGood =
    check("Auth config exists", () => {
      if (!existsSync(CONFIG_PATH)) throw new Error("Not found");
    }) && allGood;

  var config = tryGetConfig();
  if (config) {
    allGood =
      (await asyncCheck("API token valid", async () => {
        await cfApi("GET", "/user/tokens/verify", null, config.apiToken);
      })) && allGood;

    allGood =
      (await asyncCheck("Account accessible", async () => {
        var res = await cfApi("GET", "/accounts", null, config.apiToken);
        if (!res.result?.length) throw new Error("No accounts");
      })) && allGood;

    allGood =
      (await asyncCheck("Workers subdomain configured", async () => {
        var sub = await getWorkersSubdomain(config);
        if (!sub) throw new Error("Not configured");
      })) && allGood;

    allGood =
      (await asyncCheck("Registry credentials obtainable", async () => {
        await getRegistryCredentials(config);
      })) && allGood;
  }

  process.stderr.write(`\n${kleur.dim("─".repeat(40))}\n`);
  if (allGood) {
    process.stderr.write(kleur.green("All checks passed.\n\n"));
  } else {
    process.stderr.write(
      kleur.yellow("Some checks failed. Fix the issues above and re-run.\n\n")
    );
  }
}

function check(label, fn) {
  try {
    fn();
    process.stderr.write(`  ${PASS}  ${label}\n`);
    return true;
  } catch {
    process.stderr.write(`  ${FAIL}  ${label}\n`);
    return false;
  }
}

async function asyncCheck(label, fn) {
  try {
    await fn();
    process.stderr.write(`  ${PASS}  ${label}\n`);
    return true;
  } catch {
    process.stderr.write(`  ${FAIL}  ${label}\n`);
    return false;
  }
}
