import { createInterface } from "readline";
import { cfApi, saveConfig } from "../lib/cf.js";
import { success, fatal, hint, fmt } from "../lib/output.js";
import kleur from "kleur";

var TOKEN_URL =
  "https://dash.cloudflare.com/profile/api-tokens?" +
  "permissionGroupKeys=" +
  encodeURIComponent(
    JSON.stringify([
      { key: "workers_scripts", type: "edit" },
      { key: "containers", type: "edit" },
      { key: "zone", type: "read" },
      { key: "dns", type: "edit" },
    ])
  ) +
  "&name=flarepilot-cli";

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function auth() {
  process.stderr.write(`\n${kleur.bold("Authenticate with Cloudflare")}\n\n`);
  process.stderr.write("Create an API token:\n");
  process.stderr.write(`  ${fmt.url(TOKEN_URL)}\n\n`);

  var rl = createInterface({ input: process.stdin, output: process.stderr });
  var apiToken = await prompt(rl, "Paste your API token: ");

  apiToken = (apiToken || "").trim();
  if (!apiToken) {
    rl.close();
    fatal("No token provided.");
  }

  // Verify token
  process.stderr.write("\nVerifying...\n");
  try {
    await cfApi("GET", "/user/tokens/verify", null, apiToken);
  } catch (e) {
    rl.close();
    fatal("Token verification failed.", e.message);
  }

  // Get accounts
  var accounts = await cfApi("GET", "/accounts", null, apiToken);
  if (!accounts.result || accounts.result.length === 0) {
    rl.close();
    fatal("No accounts found for this token.");
  }

  var account;

  if (accounts.result.length === 1) {
    account = accounts.result[0];
  } else {
    // Multiple accounts — let user pick
    process.stderr.write("\nMultiple accounts found:\n\n");
    for (var i = 0; i < accounts.result.length; i++) {
      var a = accounts.result[i];
      process.stderr.write(
        `  ${kleur.bold(`[${i + 1}]`)} ${a.name} ${fmt.dim(`(${a.id})`)}\n`
      );
    }
    process.stderr.write("\n");

    var choice = await prompt(
      rl,
      `Select account [1-${accounts.result.length}]: `
    );
    var idx = parseInt(choice, 10) - 1;

    if (isNaN(idx) || idx < 0 || idx >= accounts.result.length) {
      rl.close();
      fatal("Invalid selection.");
    }

    account = accounts.result[idx];
  }

  rl.close();

  saveConfig({ accountId: account.id, apiToken });

  success("Authenticated!");
  process.stderr.write(
    `  Account: ${fmt.bold(account.name)} ${fmt.dim(`(${account.id})`)}\n`
  );
  hint("Next", "flarepilot deploy <name> ./path");
}
