import { buildSync } from "esbuild";
import { join, dirname } from "path";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  cpSync,
} from "fs";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { homedir } from "os";
import { fileURLToPath } from "url";

var __dirname = dirname(fileURLToPath(import.meta.url));
var templateDir = join(__dirname, "..", "..", "..", "worker-template");
var cacheDir = join(homedir(), ".flarepilot");
var bundlePath = join(cacheDir, "worker-bundle.js");
var hashPath = join(cacheDir, "worker-bundle.hash");

export function templateHash() {
  var source = readFileSync(join(templateDir, "src", "index.js"), "utf-8");
  var pkg = readFileSync(join(templateDir, "package.json"), "utf-8");
  return createHash("sha256").update(source + pkg).digest("hex").slice(0, 16);
}

export function getWorkerBundle() {
  var hash = templateHash();

  // Cache hit
  if (existsSync(bundlePath) && existsSync(hashPath)) {
    var cached = readFileSync(hashPath, "utf-8").trim();
    if (cached === hash) {
      return readFileSync(bundlePath, "utf-8");
    }
  }

  console.log("Bundling worker template (first deploy, cached after this)...");

  // Build in a temp work dir
  var workDir = join(cacheDir, "bundle-work");
  mkdirSync(join(workDir, "src"), { recursive: true });
  cpSync(join(templateDir, "src", "index.js"), join(workDir, "src", "index.js"));
  cpSync(join(templateDir, "package.json"), join(workDir, "package.json"));

  if (!existsSync(join(workDir, "node_modules", "@cloudflare", "containers"))) {
    execSync("npm install --production", { cwd: workDir, stdio: "inherit" });
  }

  var result = buildSync({
    entryPoints: [join(workDir, "src", "index.js")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: bundlePath,
    external: ["cloudflare:*", "node:*"],
    write: true,
    minify: false,
  });

  if (result.errors.length > 0) {
    throw new Error(
      "Bundle failed: " + result.errors.map((e) => e.text).join("\n")
    );
  }

  writeFileSync(hashPath, hash);
  return readFileSync(bundlePath, "utf-8");
}
