import {
  getConfig,
  getAppConfig,
  pushAppConfig,
  findContainerApp,
  modifyContainerApp,
} from "../lib/cf.js";
import { success, fatal, fmt } from "../lib/output.js";
import { resolveAppName } from "../lib/link.js";

var VALID_HINTS = [
  "wnam", "enam", "sam", "weur", "eeur", "apac", "oc", "afr", "me",
];

export async function scale(name, options) {
  name = resolveAppName(name);
  var config = getConfig();
  var appConfig = await getAppConfig(config, name);

  if (!appConfig) {
    fatal(
      `App ${fmt.app(name)} not found.`,
      `Run ${fmt.cmd(`flarepilot deploy ${name} .`)} first.`
    );
  }

  var changed = false;

  if (options.regions) {
    var regions = options.regions.split(",").map((r) => r.trim().toLowerCase());
    for (var r of regions) {
      if (!VALID_HINTS.includes(r)) {
        fatal(
          `Invalid location hint '${r}'.`,
          `Valid hints: ${VALID_HINTS.join(", ")}`
        );
      }
    }
    appConfig.regions = regions;
    changed = true;
  }

  if (options.instances) {
    appConfig.instances = options.instances;
    changed = true;
  }

  if (options.instanceType) {
    appConfig.instanceType = options.instanceType;
    // Clear explicit resources when switching to instance type
    delete appConfig.vcpu;
    delete appConfig.memory;
    delete appConfig.disk;
    changed = true;
  }
  if (options.vcpu) {
    appConfig.vcpu = options.vcpu;
    delete appConfig.instanceType;
    changed = true;
  }
  if (options.memory) {
    appConfig.memory = options.memory;
    delete appConfig.instanceType;
    changed = true;
  }
  if (options.disk) {
    appConfig.disk = options.disk;
    delete appConfig.instanceType;
    changed = true;
  }

  if (!changed) {
    // Show current scale (topic root = show)
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            regions: appConfig.regions,
            instances: appConfig.instances,
            instanceType: appConfig.instanceType,
            vcpu: appConfig.vcpu,
            memory: appConfig.memory,
            disk: appConfig.disk,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(`\n${fmt.bold("App:")}        ${fmt.app(name)}`);
    console.log(`${fmt.bold("Regions:")}    ${appConfig.regions.join(", ")}`);
    console.log(`${fmt.bold("Instances:")}  ${appConfig.instances} per region`);
    if (appConfig.vcpu || appConfig.memory || appConfig.disk) {
      if (appConfig.vcpu) console.log(`${fmt.bold("vCPU:")}       ${appConfig.vcpu}`);
      if (appConfig.memory) console.log(`${fmt.bold("Memory:")}     ${appConfig.memory} MiB`);
      if (appConfig.disk) console.log(`${fmt.bold("Disk:")}       ${appConfig.disk} MB`);
    } else {
      console.log(`${fmt.bold("Type:")}       ${appConfig.instanceType || "lite"}`);
    }
    console.log(
      `\n${fmt.dim("Geo-routing is automatic — requests route to the closest deployed region.")}`
    );
    return;
  }

  await pushAppConfig(config, name, appConfig);

  // Update container application
  var scriptName = `flarepilot-${name}`;
  var containerApp = await findContainerApp(config, scriptName);
  if (containerApp) {
    var maxInstances = (appConfig.regions?.length || 1) * (appConfig.instances || 2);
    var modification = { max_instances: maxInstances };

    // Include resource configuration changes
    if (appConfig.vcpu || appConfig.memory || appConfig.disk) {
      modification.configuration = {};
      if (appConfig.vcpu) modification.configuration.vcpu = appConfig.vcpu;
      if (appConfig.memory) modification.configuration.memory_mib = appConfig.memory;
      if (appConfig.disk) modification.configuration.disk = { size_mb: appConfig.disk };
    } else if (appConfig.instanceType) {
      modification.configuration = { instance_type: appConfig.instanceType };
    }

    await modifyContainerApp(config, containerApp.id, modification);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          regions: appConfig.regions,
          instances: appConfig.instances,
          instanceType: appConfig.instanceType,
          vcpu: appConfig.vcpu,
          memory: appConfig.memory,
          disk: appConfig.disk,
        },
        null,
        2
      )
    );
    return;
  }

  success(`Scaled ${fmt.app(name)} (live).`);
  process.stderr.write(`  Regions:    ${appConfig.regions.join(", ")}\n`);
  process.stderr.write(`  Instances:  ${appConfig.instances}\n`);
  if (appConfig.vcpu || appConfig.memory || appConfig.disk) {
    if (appConfig.vcpu) process.stderr.write(`  vCPU:       ${appConfig.vcpu}\n`);
    if (appConfig.memory) process.stderr.write(`  Memory:     ${appConfig.memory} MiB\n`);
    if (appConfig.disk) process.stderr.write(`  Disk:       ${appConfig.disk} MB\n`);
  } else {
    process.stderr.write(`  Type:       ${appConfig.instanceType || "lite"}\n`);
  }
}
