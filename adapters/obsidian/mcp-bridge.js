import fs from "node:fs";
import http from "node:http";
import https from "node:https";

export class BridgeConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "BridgeConfigError";
  }
}

// Reads and sanity-checks the pinned CA certificate. Throws synchronously so
// callers fail closed before ever opening a listening socket.
export function loadCaCert(caCertPath) {
  if (!caCertPath) {
    throw new BridgeConfigError("No CA certificate path was provided.");
  }

  let raw;
  try {
    raw = fs.readFileSync(caCertPath);
  } catch (error) {
    throw new BridgeConfigError(
      `Unable to read CA certificate at ${caCertPath}: ${error.message}`
    );
  }

  const text = raw.toString("utf8");
  if (!text.includes("BEGIN CERTIFICATE")) {
    throw new BridgeConfigError(
      `File at ${caCertPath} does not look like a PEM certificate.`
    );
  }

  return raw;
}

function defaultLog(entry) {
  const line = entry.error
    ? `[mcp-bridge] ${entry.method} ${entry.path} -> error: ${entry.error}`
    : `[mcp-bridge] ${entry.method} ${entry.path} -> ${entry.status} (${entry.ms}ms)`;
  // Intentionally logs only method/path/status/timing/error text — never headers or bodies,
  // so an Authorization value can never reach stdout/stderr through this path.
  if (entry.error) {
    console.error(line);
  } else {
    console.log(line);
  }
}

/**
 * Creates (but does not start) a loopback HTTP -> pinned-CA HTTPS reverse
 * proxy for the Obsidian Local REST API / MCP endpoint.
 */
export function createBridgeServer({
  caCertPath,
  upstreamUrl = "https://127.0.0.1:27124",
  log = defaultLog
} = {}) {
  const ca = loadCaCert(caCertPath);
  const upstream = new URL(upstreamUrl);

  const server = http.createServer((clientReq, clientRes) => {
    const started = Date.now();

    const upstreamReq = https.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || 443,
        method: clientReq.method,
        path: clientReq.url,
        headers: { ...clientReq.headers, host: upstream.host },
        ca,
        rejectUnauthorized: true
      },
      (upstreamRes) => {
        clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
        upstreamRes.on("end", () => {
          log({
            method: clientReq.method,
            path: clientReq.url,
            status: upstreamRes.statusCode,
            ms: Date.now() - started
          });
        });
        upstreamRes.on("error", (error) => {
          log({ method: clientReq.method, path: clientReq.url, error: error.message });
          clientRes.destroy(error);
        });
      }
    );

    upstreamReq.on("error", (error) => {
      log({ method: clientReq.method, path: clientReq.url, error: error.message });
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "Content-Type": "text/plain" });
      }
      clientRes.end("Bad gateway");
    });

    clientReq.on("aborted", () => upstreamReq.destroy());
    clientRes.on("close", () => {
      if (!clientRes.writableEnded) upstreamReq.destroy();
    });

    clientReq.pipe(upstreamReq);
  });

  return server;
}
