import path from "node:path";
import process from "node:process";

import { createBridgeServer, BridgeConfigError } from "../adapters/obsidian/mcp-bridge.js";

const HOST = "127.0.0.1";
const port = Number(process.env.NEXUS_BRIDGE_PORT ?? 27125);
const upstreamUrl = process.env.NEXUS_OBSIDIAN_BASE_URL ?? "https://127.0.0.1:27124";
const caCertPath =
  process.env.NEXUS_OBSIDIAN_CA_CERT ??
  path.resolve(process.cwd(), ".obsidian-local-rest-api-ca.crt");

let server;
try {
  server = createBridgeServer({ caCertPath, upstreamUrl });
} catch (error) {
  if (error instanceof BridgeConfigError) {
    console.error(`Bridge failed to start: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

server.on("error", (error) => {
  console.error(`Bridge server error: ${error.message}`);
  process.exit(1);
});

server.listen(port, HOST, () => {
  console.log(`Obsidian MCP bridge listening on http://${HOST}:${port} -> ${upstreamUrl}`);
  console.log("Press Ctrl+C to stop.");
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
