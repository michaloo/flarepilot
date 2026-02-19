import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fatal, fmt } from "./output.js";

var LINK_FILE = ".flarepilot.json";

export function readLink() {
  try {
    var data = JSON.parse(readFileSync(LINK_FILE, "utf-8"));
    return data.app || null;
  } catch {
    return null;
  }
}

export function linkApp(name) {
  writeFileSync(LINK_FILE, JSON.stringify({ app: name }) + "\n");
}

export function unlinkApp() {
  try {
    unlinkSync(LINK_FILE);
  } catch {}
}

export function resolveAppName(name) {
  if (name) return name;
  var linked = readLink();
  if (linked) return linked;
  fatal(
    "No app specified.",
    `Provide an app name or run ${fmt.cmd("flarepilot deploy")} in this directory first.`
  );
}
