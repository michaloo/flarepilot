import { createServer } from "node:http";


var startedAt = new Date().toISOString();
var location = process.env.CLOUDFLARE_LOCATION || "unknown";
var requestCount = 0;

var regionFlags = {
  wnam: "\u{1F1FA}\u{1F1F8}", enam: "\u{1F1FA}\u{1F1F8}",
  sam: "\u{1F1E7}\u{1F1F7}", weur: "\u{1F1EA}\u{1F1FA}",
  eeur: "\u{1F1EA}\u{1F1FA}", apac: "\u{1F1EF}\u{1F1F5}",
  oc: "\u{1F1E6}\u{1F1FA}", afr: "\u{1F1F3}\u{1F1EC}",
  me: "\u{1F1E6}\u{1F1EA}",
};
var regionLabels = {
  wnam: "Western North America", enam: "Eastern North America",
  sam: "South America", weur: "Western Europe",
  eeur: "Eastern Europe", apac: "Asia-Pacific",
  oc: "Oceania", afr: "Africa", me: "Middle East",
};

var flag = regionFlags[location] || "\u{1F30D}";
var label = regionLabels[location] || location;

var server = createServer((req, res) => {
  requestCount++;

  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  if (req.url === "/api") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      location,
      uptime: process.uptime(),
      requests: requestCount,
    }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flarepilot</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { max-width: 480px; width: 100%; padding: 48px 40px; }
  .flag { font-size: 48px; margin-bottom: 16px; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; color: #fff; }
  .sub { font-size: 14px; color: #888; margin-bottom: 32px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #222; border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
  .cell { background: #111; padding: 16px; }
  .cell .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 4px; }
  .cell .value { font-size: 15px; font-weight: 500; font-family: "SF Mono", "Fira Code", monospace; color: #fff; }
  .wide { grid-column: 1 / -1; }
  .bar { height: 3px; background: #222; border-radius: 2px; margin-bottom: 24px; overflow: hidden; }
  .bar .fill { height: 100%; background: #f97316; border-radius: 2px; width: ${Math.min(requestCount, 100)}%; transition: width 0.3s; }
  .footer { font-size: 12px; color: #444; }
</style>
</head>
<body>
<div class="card">
  <div class="flag">${flag}</div>
  <h1>Running in ${label}</h1>
  <div class="sub">${location}</div>
  <div class="grid">
    <div class="cell">
      <div class="label">Location</div>
      <div class="value">${location}</div>
    </div>
    <div class="cell">
      <div class="label">Requests</div>
      <div class="value">${requestCount}</div>
    </div>
    <div class="cell">
      <div class="label">Uptime</div>
      <div class="value">${formatUptime(process.uptime())}</div>
    </div>
  </div>
  <div class="bar"><div class="fill"></div></div>
  <div class="footer">flarepilot &middot; started ${startedAt}</div>
</div>
</body>
</html>`);
});

function formatUptime(s) {
  if (s < 60) return Math.floor(s) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + Math.floor(s % 60) + "s";
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}

server.listen(8080);
