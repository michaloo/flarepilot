import { createServer } from "node:http";
import { cpus, totalmem, freemem } from "node:os";

var started = Date.now();
var requests = 0;
var location = process.env.CLOUDFLARE_LOCATION || "unknown";
var region = process.env.CLOUDFLARE_REGION || "unknown";
var country = process.env.CLOUDFLARE_COUNTRY_A2 || "";
var flag = country.length === 2
  ? String.fromCodePoint(...[...country.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
  : "\u{1F30D}";

function uptime() {
  var s = (Date.now() - started) / 1000;
  if (s < 60) return Math.floor(s) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + Math.floor(s % 60) + "s";
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}

var mb = n => (n / 1024 / 1024).toFixed(0) + " MB";

createServer((req, res) => {
  requests++;

  if (req.url === "/health") {
    res.writeHead(200);
    return res.end("ok");
  }

  var mem = process.memoryUsage();
  var ua = req.headers["user-agent"] || "";

  if (ua.startsWith("curl/") || !ua.includes("Mozilla")) {
    var rows = [
      ["Location", location],
      ["Region", region],
      ["Uptime", uptime()],
      ["Requests", String(requests)],
      ["CPUs", String(cpus().length)],
      ["Memory", `${mb(mem.rss)} / ${mb(totalmem())}`],
    ];
    var w = Math.max(...rows.map(r => r[0].length));
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(
      `\nHello World ${flag} from Node.js ${process.version}\n\n` +
      rows.map(([k, v]) => `  ${k.padStart(w)}  ${v}`).join("\n") + "\n"
    );
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>flarepilot</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #aaa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .c { text-align: center; }
  h1 { color: #fff; font-size: 32px; margin: 0; font-weight: 400; }
  h1 s { color: #555; }
  .sub { color: #555; font-size: 14px; margin: 8px 0 24px; }
  table { margin: 0 auto; border-collapse: collapse; font-size: 14px; }
  td { padding: 4px 12px; }
  td:first-child { color: #555; text-align: right; }
  td:last-child { color: #fff; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<div class="c">
  <h1>Hello <s>World</s> ${flag}</h1>
  <div class="sub">Node.js ${process.version}</div>
  <table>
    <tr><td>Location</td><td>${location}</td></tr>
    <tr><td>Region</td><td>${region}</td></tr>
    <tr><td>Uptime</td><td>${uptime()}</td></tr>
    <tr><td>Requests</td><td>${requests}</td></tr>
    <tr><td>CPUs</td><td>${cpus().length}</td></tr>
    <tr><td>Memory</td><td>${mb(mem.rss)} / ${mb(totalmem())}</td></tr>

  </table>
</div>
</body>
</html>`);
}).listen(8080);
