# Changelog

## 0.4.0

- Restored `--image` flag on `deploy` command for deploying pre-built Docker images (skip local build)
- Fixed hard coded package version

## 0.3.0

- Flattened monorepo into single package
- Added `db` commands for D1 database management (shell, query, import/export)
- Improved WebSocket support in worker template
- Moved env vars out of json config into worker settings, this allow setting them as secrets
- Added `image` flag to use existing image instead of building local Dockerfile
- Added `CHANGELOG.md`


## 0.2.0

- Added `cost` command for estimated usage and pricing breakdown
- Added resource usage stats to `ps` output

## 0.1.0

- Initial release
- Deploy apps from a Dockerfile to Cloudflare Containers
- App management (create, list, destroy)
- Environment variable config (`config set/get/unset`)
- Custom domains with automatic DNS and SSL
- Auto-scaling configuration
- Live log streaming
- D1 database provisioning and management (shell, query, import/export)
- System diagnostics (`doctor`)
