import { getConfig, getAppConfig, getWorkersSubdomain } from "../lib/cf.js";
import { fatal, fmt } from "../lib/output.js";
import { resolveAppName } from "../lib/link.js";
import kleur from "kleur";

export async function ps(name, options) {
  name = resolveAppName(name);
  var config = getConfig();
  var appConfig = await getAppConfig(config, name);

  if (!appConfig) {
    fatal(
      `App ${fmt.app(name)} not found.`,
      `Run ${fmt.cmd(`flarepilot deploy ${name} .`)} first.`
    );
  }

  var instances = appConfig.instances || 2;

  if (options.json) {
    var doInstances = [];
    for (var region of appConfig.regions) {
      for (var i = 0; i < instances; i++) {
        doInstances.push({
          id: `${region}-${i}`,
          region,
          index: i,
        });
      }
    }
    console.log(
      JSON.stringify(
        {
          name,
          image: appConfig.image,
          regions: appConfig.regions,
          instances,
          containers: doInstances,
        },
        null,
        2
      )
    );
    return;
  }

  var subdomain = await getWorkersSubdomain(config);
  var defaultUrl = subdomain
    ? `https://flarepilot-${name}.${subdomain}.workers.dev`
    : null;
  var customDomains = appConfig.domains || [];

  console.log("");
  console.log(`${fmt.bold("App:")}        ${fmt.app(name)}`);
  if (customDomains.length > 0) {
    console.log(`${fmt.bold("URL:")}        ${fmt.url(`https://${customDomains[0]}`)}`);
    for (var d of customDomains.slice(1)) {
      console.log(`             ${fmt.url(`https://${d}`)}`);
    }
    if (defaultUrl) {
      console.log(`             ${fmt.dim(defaultUrl)}`);
    }
  } else if (defaultUrl) {
    console.log(`${fmt.bold("URL:")}        ${fmt.url(defaultUrl)}`);
  }
  console.log(
    `${fmt.bold("Image:")}      ${appConfig.image || fmt.dim("(not deployed)")}`
  );
  console.log(`${fmt.bold("Regions:")}    ${appConfig.regions.join(", ")}`);
  console.log(`${fmt.bold("Instances:")}  ${instances} per region`);

  if (appConfig.deployedAt) {
    console.log(`${fmt.bold("Deployed:")}   ${appConfig.deployedAt}`);
  }

  console.log(`\n${fmt.bold("Containers:")}`);
  for (var region of appConfig.regions) {
    for (var i = 0; i < instances; i++) {
      console.log(`  ${kleur.green("●")} ${region}-${i}`);
    }
  }

  console.log(
    `\n${fmt.dim("Geo-routing: automatic (nearest region based on request origin)")}`
  );
}
