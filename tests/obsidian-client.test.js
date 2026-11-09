import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  ObsidianApiError,
  ObsidianClient,
  encodeVaultPath
} from "../adapters/obsidian/obsidian-client.js";

test("encodes each vault path segment and rejects traversal", () => {
  assert.equal(
    encodeVaultPath("02-Knowledge/Café notes.md"),
    "02-Knowledge/Caf%C3%A9%20notes.md"
  );
  assert.throws(() => encodeVaultPath("../secret"), /invalid segment/);
  assert.throws(() => encodeVaultPath("/absolute.md"), /relative path/);
});

test("supports status, CRUD, metadata, search, tags, and directory listing", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });

    if (request.headers.authorization !== "Bearer test-key") {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Unauthorized" }));
      return;
    }

    if (request.url.startsWith("/search/simple/")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify([{ filename: "note.md", score: 1 }]));
    } else if (request.url === "/tags/") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ tags: { nexus: 1 } }));
    } else if (request.url === "/vault/") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ files: ["note.md"] }));
    } else if (request.method === "GET" && request.headers.accept.includes("note+json")) {
      response.writeHead(200, { "Content-Type": "application/vnd.olrapi.note+json" });
      response.end(JSON.stringify({ path: "note.md", tags: ["nexus"] }));
    } else if (request.method === "GET" && request.url === "/vault/note.md") {
      response.writeHead(200, { "Content-Type": "text/markdown" });
      response.end("# Note");
    } else if (request.method === "PATCH") {
      response.writeHead(200, { "Content-Type": "text/markdown" });
      response.end("# Note\n\nPatched");
    } else if (request.method === "PUT" || request.method === "POST" || request.method === "DELETE") {
      response.writeHead(204);
      response.end();
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ service: "Obsidian Local REST API", authenticated: true }));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const client = new ObsidianClient({
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${port}`
  });

  assert.equal((await client.status()).authenticated, true);
  assert.deepEqual(await client.list(), { files: ["note.md"] });
  assert.equal(await client.read("note.md"), "# Note");
  assert.deepEqual(await client.metadata("note.md"), { path: "note.md", tags: ["nexus"] });
  await client.write("note.md", "# Updated");
  await client.update("note.md", "# Replaced");
  await client.append("note.md", "\nMore");
  assert.equal(await client.patch("note.md", {
    operation: "replace",
    targetType: "frontmatter",
    target: "tags",
    contentType: "application/json",
    content: ["nexus"],
    createTargetIfMissing: true
  }), "# Note\n\nPatched");
  assert.equal((await client.search("Note"))[0].filename, "note.md");
  assert.deepEqual(await client.tags(), { tags: { nexus: 1 } });
  await client.delete("note.md");

  assert.ok(requests.every((request) => request.headers.authorization === "Bearer test-key"));
  assert.ok(requests.some((request) => request.method === "PATCH"
    && request.headers.operation === "replace"
    && request.body === '["nexus"]'));
});

test("throws a typed error with the API response", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "File does not exist." }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();

  const client = new ObsidianClient({
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${port}`
  });

  await assert.rejects(
    client.read("missing.md"),
    (error) => error instanceof ObsidianApiError
      && error.status === 404
      && error.message.includes("File does not exist")
  );
});

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

