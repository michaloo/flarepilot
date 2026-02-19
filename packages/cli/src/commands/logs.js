import { getConfig, createTail, deleteTail } from "../lib/cf.js";
import { fatal, fmt } from "../lib/output.js";
import { resolveAppName } from "../lib/link.js";
import kleur from "kleur";

export async function logs(name) {
  name = resolveAppName(name);
  var config = getConfig();
  var scriptName = `flarepilot-${name}`;

  process.stderr.write(
    `Tailing logs for ${fmt.app(name)}... ${fmt.dim("(ctrl+c to stop)")}\n\n`
  );

  var tail;
  try {
    tail = await createTail(config, scriptName);
  } catch (e) {
    fatal(
      `Could not start log tail for ${fmt.app(name)}.`,
      e.message
    );
  }

  var ws = new WebSocket(tail.url, "trace-v1");

  ws.addEventListener("open", function () {
    // Send empty filters to start receiving all events
    ws.send(JSON.stringify({}));
  });

  ws.addEventListener("message", async function (event) {
    var raw = typeof event.data === "string" ? event.data : await event.data.text();
    var data = JSON.parse(raw);

    for (var evt of Array.isArray(data) ? data : [data]) {
      var ts = evt.eventTimestamp
        ? new Date(evt.eventTimestamp).toISOString()
        : new Date().toISOString();
      var method = evt.event?.request?.method || "";
      var url = evt.event?.request?.url || "";
      var statusCode = evt.event?.response?.status || "";
      var outcome = evt.outcome || "";

      if (method) {
        var statusColor =
          statusCode >= 500
            ? kleur.red(statusCode)
            : statusCode >= 400
              ? kleur.yellow(statusCode)
              : kleur.green(statusCode);
        console.log(
          `${kleur.dim(ts)}  ${kleur.bold(method)} ${url} ${statusColor} ${kleur.dim(`[${outcome}]`)}`
        );
      }

      if (evt.logs) {
        for (var log of evt.logs) {
          var level = log.level || "log";
          var msg = (log.message || []).join(" ");
          var levelColor =
            level === "error"
              ? kleur.red(`[${level}]`)
              : level === "warn"
                ? kleur.yellow(`[${level}]`)
                : kleur.dim(`[${level}]`);
          console.log(`${kleur.dim(ts)}  ${levelColor} ${msg}`);
        }
      }

      if (evt.exceptions) {
        for (var ex of evt.exceptions) {
          console.error(
            `${kleur.dim(ts)}  ${kleur.red("[exception]")} ${ex.name}: ${ex.message}`
          );
        }
      }
    }
  });

  ws.addEventListener("error", function (event) {
    process.stderr.write(
      `${kleur.red("WebSocket error:")} ${event.message || "connection failed"}\n`
    );
  });

  ws.addEventListener("close", function () {
    process.stderr.write(`\n${fmt.dim("Tail disconnected.")}\n`);
    process.exit(0);
  });

  process.on("SIGINT", async function () {
    process.stderr.write(`\n${fmt.dim("Stopping tail...")}\n`);
    ws.close();
    try {
      await deleteTail(config, scriptName, tail.id);
    } catch {}
    process.exit(0);
  });
}
