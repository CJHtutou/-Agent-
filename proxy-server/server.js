import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

loadEnvFile();

const config = {
  port: Number(process.env.PORT || 8787),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekBaseUrl: normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"),
  model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  proxyApiKey: process.env.PROXY_API_KEY || "",
  forceModel: String(process.env.FORCE_MODEL || "false").toLowerCase() === "true",
  allowOrigin: process.env.ALLOW_ORIGIN || "*",
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 600000)
};

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/" || req.url === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "deepseek-codex-proxy",
      upstream: config.deepseekBaseUrl,
      defaultModel: config.model
    });
    return;
  }

  if (!config.deepseekApiKey) {
    sendJson(res, 500, {
      error: {
        message: "Missing DEEPSEEK_API_KEY on proxy server.",
        type: "configuration_error"
      }
    });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, {
      error: {
        message: "Unauthorized proxy request.",
        type: "authentication_error"
      }
    });
    return;
  }

  try {
    await forwardToDeepSeek(req, res);
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 502, {
        error: {
          message: error.message || "Proxy request failed.",
          type: "proxy_error"
        }
      });
    } else {
      res.end();
    }
  }
});

server.listen(config.port, () => {
  console.log(`[proxy] listening on http://127.0.0.1:${config.port}`);
  console.log(`[proxy] upstream: ${config.deepseekBaseUrl}`);
  console.log(`[proxy] default model: ${config.model}`);
});

async function forwardToDeepSeek(req, res) {
  const upstreamPath = mapPath(req.url || "");

  if (!upstreamPath) {
    sendJson(res, 404, {
      error: {
        message: "Unsupported endpoint. Use /v1/chat/completions, /chat/completions, /v1/models, or /models.",
        type: "not_found"
      }
    });
    return;
  }

  const headers = {
    Authorization: `Bearer ${config.deepseekApiKey}`,
    Accept: req.headers.accept || "application/json"
  };

  let body;
  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    const rawBody = await readRequestBody(req);
    body = patchJsonBody(rawBody, req.headers["content-type"]);
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  const upstreamResponse = await fetch(`${config.deepseekBaseUrl}${upstreamPath}`, {
    method: req.method,
    headers,
    body,
    signal: controller.signal
  }).finally(() => clearTimeout(timer));

  const responseHeaders = {};
  upstreamResponse.headers.forEach((value, key) => {
    if (!["content-encoding", "content-length", "transfer-encoding"].includes(key.toLowerCase())) {
      responseHeaders[key] = value;
    }
  });
  responseHeaders["access-control-allow-origin"] = config.allowOrigin;
  responseHeaders["access-control-allow-headers"] = "Authorization, Content-Type";
  responseHeaders["access-control-allow-methods"] = "GET, POST, OPTIONS";

  res.writeHead(upstreamResponse.status, responseHeaders);

  if (!upstreamResponse.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstreamResponse.body).pipe(res);
}

function mapPath(url) {
  const parsed = new URL(url, "http://localhost");
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/v1/chat/completions" || pathname === "/chat/completions") {
    return `/chat/completions${parsed.search}`;
  }

  if (pathname === "/v1/models" || pathname === "/models") {
    return `/models${parsed.search}`;
  }

  return "";
}

function patchJsonBody(rawBody, contentType = "") {
  if (!rawBody) {
    return rawBody;
  }

  if (!String(contentType).toLowerCase().includes("application/json")) {
    return rawBody;
  }

  const payload = JSON.parse(rawBody);
  if (config.forceModel || !payload.model) {
    payload.model = config.model;
  }

  return JSON.stringify(payload);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isAuthorized(req) {
  if (!config.proxyApiKey) {
    return true;
  }

  const auth = req.headers.authorization || "";
  return auth === `Bearer ${config.proxyApiKey}`;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", config.allowOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
