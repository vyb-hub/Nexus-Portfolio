import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBridgeServer, loadCaCert, BridgeConfigError } from "../adapters/obsidian/mcp-bridge.js";

const SECRET_TOKEN = "Bearer super-secret-token-do-not-log";

function generateCa(dir, name) {
  const keyPath = path.join(dir, `${name}-key.pem`);
  const certPath = path.join(dir, `${name}-cert.pem`);
  execFileSync("openssl", ["ecparam", "-genkey", "-name", "prime256v1", "-noout", "-out", keyPath]);
  execFileSync("openssl", [
    "req", "-x509", "-new", "-key", keyPath, "-days", "2",
    "-out", certPath, "-subj", `/CN=Test CA ${name}`
  ]);
  return { keyPath, certPath };
}

function generateLeaf(dir, name, ca) {
  const keyPath = path.join(dir, `${name}-key.pem`);
  const csrPath = path.join(dir, `${name}.csr`);
  const certPath = path.join(dir, `${name}-cert.pem`);
  const extPath = path.join(dir, `${name}-ext.cnf`);
  fs.writeFileSync(extPath, "subjectAltName=IP:127.0.0.1\n");
  execFileSync("openssl", ["ecparam", "-genkey", "-name", "prime256v1", "-noout", "-out", keyPath]);
  execFileSync("openssl", ["req", "-new", "-key", keyPath, "-out", csrPath, "-subj", "/CN=127.0.0.1"]);
  execFileSync("openssl", [
    "x509", "-req", "-in", csrPath, "-CA", ca.certPath, "-CAkey", ca.keyPath,
    "-CAcreateserial", "-out", certPath, "-days", "2", "-extfile", extPath
  ]);
  return { keyPath, certPath };
}

function listen(server, port = 0, host = "127.0.0.1") {
  return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
}

function requestBridge(address, { method = "GET", path: reqPath = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: address.address, port: address.port, method, path: reqPath, headers },
      (res) => {
        const chunks = [];
        const chunkTimes = [];
        res.on("data", (chunk) => {
          chunkTimes.push(Date.now());
          chunks.push(chunk);
        });
        res.on("end", () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
          chunkTimes
        }));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

let workDir;
let caA;
let leafA; // valid: signed by caA
let caB;
let leafB; // invalid from the bridge's point of view: signed by a different CA

test.before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-bridge-test-"));
  caA = generateCa(workDir, "a");
  leafA = generateLeaf(workDir, "leaf-a", caA);
  caB = generateCa(workDir, "b");
  leafB = generateLeaf(workDir, "leaf-b", caB);
});

test.after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("loadCaCert fails closed when the CA file is missing or invalid", () => {
  assert.throws(() => loadCaCert(path.join(workDir, "does-not-exist.crt")), BridgeConfigError);

  const bogusPath = path.join(workDir, "bogus.crt");
  fs.writeFileSync(bogusPath, "not a certificate");
  assert.throws(() => loadCaCert(bogusPath), BridgeConfigError);

  assert.throws(() => loadCaCert(undefined), BridgeConfigError);
});

test("createBridgeServer fails closed before listening when the CA is invalid", () => {
  assert.throws(
    () => createBridgeServer({ caCertPath: path.join(workDir, "missing.crt") }),
    BridgeConfigError
  );
});

test("binds to loopback only", async () => {
  const bridge = createBridgeServer({
    caCertPath: caA.certPath,
    upstreamUrl: "https://127.0.0.1:1" // never contacted in this test
  });
  const address = await listen(bridge);
  try {
    assert.equal(address.address, "127.0.0.1");
  } finally {
    bridge.close();
  }
});

test("forwards an authenticated request preserving method, path, headers, body, and MCP session headers", async () => {
  const seen = [];
  const upstream = https.createServer(
    { key: fs.readFileSync(leafA.keyPath), cert: fs.readFileSync(leafA.certPath) },
    async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      seen.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        sessionHeader: req.headers["mcp-session-id"],
        body: Buffer.concat(chunks).toString("utf8")
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": "session-xyz"
      });
      res.end(JSON.stringify({ ok: true }));
    }
  );
  const upstreamAddress = await listen(upstream);

  const bridge = createBridgeServer({
    caCertPath: caA.certPath,
    upstreamUrl: `https://127.0.0.1:${upstreamAddress.port}`
  });
  const bridgeAddress = await listen(bridge);

  try {
    const response = await requestBridge(bridgeAddress, {
      method: "POST",
      path: "/mcp/tools/call",
      headers: {
        Authorization: SECRET_TOKEN,
        "Mcp-Session-Id": "session-xyz",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength('{"tool":"list"}')
      },
      body: '{"tool":"list"}'
    });

    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });
    assert.equal(response.headers["mcp-session-id"], "session-xyz");

    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].url, "/mcp/tools/call");
    assert.equal(seen[0].authorization, SECRET_TOKEN);
    assert.equal(seen[0].sessionHeader, "session-xyz");
    assert.equal(seen[0].body, '{"tool":"list"}');
  } finally {
    bridge.close();
    upstream.close();
  }
});

test("streams responses instead of buffering them fully before forwarding", async () => {
  const upstream = https.createServer(
    { key: fs.readFileSync(leafA.keyPath), cert: fs.readFileSync(leafA.certPath) },
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("chunk-one-");
      setTimeout(() => {
        res.write("chunk-two-");
        res.end("chunk-three");
      }, 150);
    }
  );
  const upstreamAddress = await listen(upstream);

  const bridge = createBridgeServer({
    caCertPath: caA.certPath,
    upstreamUrl: `https://127.0.0.1:${upstreamAddress.port}`
  });
  const bridgeAddress = await listen(bridge);

  try {
    const response = await requestBridge(bridgeAddress, { path: "/" });
    assert.equal(response.body, "chunk-one-chunk-two-chunk-three");
    assert.ok(
      response.chunkTimes.length >= 2,
      "expected at least two separate data events, proving the response was streamed rather than buffered"
    );
    const gap = response.chunkTimes[response.chunkTimes.length - 1] - response.chunkTimes[0];
    assert.ok(gap >= 100, `expected a delay between the first and last chunk, got ${gap}ms`);
  } finally {
    bridge.close();
    upstream.close();
  }
});

test("rejects an upstream certificate not signed by the configured CA", async () => {
  const upstream = https.createServer(
    { key: fs.readFileSync(leafB.keyPath), cert: fs.readFileSync(leafB.certPath) },
    (_req, res) => {
      res.writeHead(200);
      res.end("should never be reached");
    }
  );
  const upstreamAddress = await listen(upstream);

  const logs = [];
  const bridge = createBridgeServer({
    caCertPath: caA.certPath, // trusts CA "a" only; upstream presents a cert signed by CA "b"
    upstreamUrl: `https://127.0.0.1:${upstreamAddress.port}`,
    log: (entry) => logs.push(entry)
  });
  const bridgeAddress = await listen(bridge);

  try {
    const response = await requestBridge(bridgeAddress, {
      path: "/",
      headers: { Authorization: SECRET_TOKEN }
    });

    assert.equal(response.status, 502);
    assert.notEqual(response.body, "should never be reached");

    const errorEntry = logs.find((entry) => entry.error);
    assert.ok(errorEntry, "expected the bridge to log a TLS verification failure");
    assert.match(errorEntry.error, /certificate|verify|unable to verify/i);
  } finally {
    bridge.close();
    upstream.close();
  }
});

test("never logs authorization header values, on success or failure", async () => {
  const upstream = https.createServer(
    { key: fs.readFileSync(leafA.keyPath), cert: fs.readFileSync(leafA.certPath) },
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    }
  );
  const upstreamAddress = await listen(upstream);

  const capturedLogs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => capturedLogs.push(args.join(" "));
  console.error = (...args) => capturedLogs.push(args.join(" "));

  const bridge = createBridgeServer({
    caCertPath: caA.certPath,
    upstreamUrl: `https://127.0.0.1:${upstreamAddress.port}`
    // no `log` override: exercises the real default logger's stdout/stderr output
  });
  const bridgeAddress = await listen(bridge);

  try {
    await requestBridge(bridgeAddress, {
      path: "/secret-op",
      headers: { Authorization: SECRET_TOKEN }
    });

    const badUpstream = https.createServer(
      { key: fs.readFileSync(leafB.keyPath), cert: fs.readFileSync(leafB.certPath) },
      (_req, res) => res.end("unused")
    );
    const badUpstreamAddress = await listen(badUpstream);
    const failingBridge = createBridgeServer({
      caCertPath: caA.certPath,
      upstreamUrl: `https://127.0.0.1:${badUpstreamAddress.port}`
    });
    const failingBridgeAddress = await listen(failingBridge);
    await requestBridge(failingBridgeAddress, {
      path: "/secret-op",
      headers: { Authorization: SECRET_TOKEN }
    });
    failingBridge.close();
    badUpstream.close();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    bridge.close();
    upstream.close();
  }

  const joined = capturedLogs.join("\n");
  assert.ok(!joined.includes(SECRET_TOKEN), "log output must never contain the Authorization value");
  assert.ok(!joined.includes("super-secret-token-do-not-log"), "log output must never contain the raw token");
});
