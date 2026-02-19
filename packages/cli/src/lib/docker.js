import { execSync } from "child_process";

function ensureDocker() {
  try {
    execSync("docker version", { stdio: "pipe" });
  } catch {
    console.error("Docker is not running. Install and start Docker first.");
    process.exit(1);
  }
}

export function dockerBuild(contextPath, tag) {
  ensureDocker();
  execSync(
    `docker build --platform linux/amd64 --provenance=false -t ${tag} ${contextPath}`,
    { stdio: "inherit" }
  );
}

export function dockerTag(source, target) {
  execSync(`docker tag ${source} ${target}`, { stdio: "inherit" });
}

export function dockerPush(tag) {
  execSync(`docker push ${tag}`, { stdio: "inherit" });
}

export function dockerLogin(registry, username, password) {
  execSync(
    `docker login --password-stdin --username ${username} ${registry}`,
    { input: password, stdio: ["pipe", "inherit", "inherit"] }
  );
}
