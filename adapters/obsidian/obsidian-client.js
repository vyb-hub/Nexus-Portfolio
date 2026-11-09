import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const NOTE_JSON = "application/vnd.olrapi.note+json";

export class ObsidianApiError extends Error {
  constructor(message, { status, method, url, body } = {}) {
    super(message);
    this.name = "ObsidianApiError";
    this.status = status;
    this.method = method;
    this.url = url;
    this.body = body;
  }
}

export class ObsidianClient {
  constructor({
    apiKey,
    baseUrl = "https://127.0.0.1:27124",
    caCertPath,
    allowSelfSigned = false,
    timeoutMs = 10_000
  } = {}) {
    if (!apiKey) {
      throw new TypeError("Obsidian API key is required.");
    }

    this.apiKey = apiKey;
    this.baseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    this.timeoutMs = timeoutMs;
    this.httpsOptions = {
      rejectUnauthorized: !allowSelfSigned,
      ...(caCertPath ? { ca: fs.readFileSync(caCertPath) } : {})
    };
  }

  async status() {
    return this.#request("", { accept: "application/json" });
  }

  async list(directory = "") {
    const suffix = directory ? `${encodeVaultPath(directory)}/` : "";
    return this.#request(`vault/${suffix}`, { accept: "application/json" });
  }

  async read(path) {
    return this.#request(`vault/${encodeVaultPath(path)}`, {
      accept: "text/markdown"
    });
  }

  async metadata(path) {
    return this.#request(`vault/${encodeVaultPath(path)}`, {
      accept: NOTE_JSON
    });
  }

  async write(path, content) {
    await this.#request(`vault/${encodeVaultPath(path)}`, {
      method: "PUT",
      contentType: "text/markdown",
      body: content
    });
  }

  async update(path, content) {
    return this.write(path, content);
  }

  async append(path, content) {
    await this.#request(`vault/${encodeVaultPath(path)}`, {
      method: "POST",
      contentType: "text/markdown",
      body: content
    });
  }

  async patch(path, {
    operation,
    targetType,
    target,
    content,
    contentType = "text/markdown",
    createTargetIfMissing = false
  }) {
    const headers = {
      Operation: operation,
      "Target-Type": targetType,
      Target: target,
      "Create-Target-If-Missing": String(createTargetIfMissing)
    };

    return this.#request(`vault/${encodeVaultPath(path)}`, {
      method: "PATCH",
      contentType,
      headers,
      body: contentType === "application/json" ? JSON.stringify(content) : content
    });
  }

  async delete(path) {
    await this.#request(`vault/${encodeVaultPath(path)}`, {
      method: "DELETE"
    });
  }

  async search(query, { contextLength = 100 } = {}) {
    const params = new URLSearchParams({
      query,
      contextLength: String(contextLength)
    });
    return this.#request(`search/simple/?${params}`, {
      method: "POST",
      accept: "application/json"
    });
  }

  async tags() {
    return this.#request("tags/", { accept: "application/json" });
  }

  async #request(path, {
    method = "GET",
    accept,
    contentType,
    headers = {},
    body
  } = {}) {
    const url = new URL(path, this.baseUrl);
    const transport = url.protocol === "https:" ? https : http;
    const payload = body === undefined ? undefined : Buffer.from(String(body));

    const response = await new Promise((resolve, reject) => {
      const request = transport.request(url, {
        method,
        timeout: this.timeoutMs,
        ...(url.protocol === "https:" ? this.httpsOptions : {}),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(accept ? { Accept: accept } : {}),
          ...(contentType ? { "Content-Type": contentType } : {}),
          ...(payload ? { "Content-Length": payload.byteLength } : {}),
          ...headers
        }
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({
          status: res.statusCode,
          contentType: res.headers["content-type"] ?? "",
          text: Buffer.concat(chunks).toString("utf8")
        }));
      });

      request.on("timeout", () => {
        request.destroy(new Error(`Obsidian request timed out after ${this.timeoutMs}ms.`));
      });
      request.on("error", reject);
      if (payload) request.write(payload);
      request.end();
    });

    const parsed = parseBody(response.text, response.contentType);
    if (response.status < 200 || response.status >= 300) {
      const detail = parsed?.message ?? response.text ?? `HTTP ${response.status}`;
      throw new ObsidianApiError(`Obsidian API request failed: ${detail}`, {
        status: response.status,
        method,
        url: url.toString(),
        body: parsed
      });
    }

    return parsed;
  }
}

export function encodeVaultPath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/")) {
    throw new TypeError("Vault path must be a non-empty relative path.");
  }

  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new TypeError("Vault path contains an invalid segment.");
  }
  return segments.map(encodeURIComponent).join("/");
}

function parseBody(text, contentType) {
  if (!text) return undefined;
  if (contentType.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

