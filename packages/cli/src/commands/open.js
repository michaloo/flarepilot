import { execSync } from "child_process";
import { platform } from "os";
import { getConfig, getWorkersSubdomain } from "../lib/cf.js";
import { fatal, fmt } from "../lib/output.js";
import { resolveAppName } from "../lib/link.js";

export async function open(name) {
  name = resolveAppName(name);
  var config = getConfig();
  var subdomain = await getWorkersSubdomain(config);

  if (!subdomain) {
    fatal(
      "Could not resolve workers.dev subdomain.",
      "Ensure your Cloudflare account has a workers.dev subdomain configured."
    );
  }

  var url = `https://flarepilot-${name}.${subdomain}.workers.dev`;

  process.stderr.write(`Opening ${fmt.url(url)}...\n`);

  var cmd;
  switch (platform()) {
    case "darwin":
      cmd = "open";
      break;
    case "win32":
      cmd = "start";
      break;
    default:
      cmd = "xdg-open";
      break;
  }

  try {
    execSync(`${cmd} "${url}"`, { stdio: "ignore" });
  } catch {
    // Fallback: just print the URL
    console.log(url);
  }
}
