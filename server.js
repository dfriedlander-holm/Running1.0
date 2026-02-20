const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const MAX_BODY_BYTES = 32 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let raw = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      total += Buffer.byteLength(chunk);
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function handleStravaExchange(req, res) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const redirectUri = process.env.STRAVA_REDIRECT_URI || "";

  if (!clientId || !clientSecret) {
    sendJson(res, 500, {
      error: "Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET on the server.",
    });
    return;
  }

  let code = "";
  try {
    const raw = await parseBody(req);
    const body = raw ? JSON.parse(raw) : {};
    code = String(body.code || "").trim();
  } catch (_err) {
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }

  if (!code) {
    sendJson(res, 400, { error: "Missing code in request body." });
    return;
  }

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
  });
  if (redirectUri) form.set("redirect_uri", redirectUri);

  let stravaRes;
  try {
    stravaRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch (_err) {
    sendJson(res, 502, { error: "Could not reach Strava token endpoint." });
    return;
  }

  let stravaBody = {};
  try {
    stravaBody = await stravaRes.json();
  } catch (_err) {}

  if (!stravaRes.ok) {
    const message = stravaBody?.message || `Strava token exchange failed (${stravaRes.status}).`;
    sendJson(res, stravaRes.status, { error: message, details: stravaBody?.errors || [] });
    return;
  }

  sendJson(res, 200, {
    access_token: stravaBody.access_token,
    expires_at: stravaBody.expires_at,
    token_type: stravaBody.token_type,
  });
}

function resolveFilePath(urlPathname) {
  const requestPath = decodeURIComponent(urlPathname.split("?")[0]);
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const relPath = safePath === "/" ? "/index.html" : safePath;
  return path.join(ROOT, relPath);
}

function serveStatic(req, res) {
  const filePath = resolveFilePath(req.url || "/");

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/strava/exchange")) {
    await handleStravaExchange(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  process.stdout.write(`Running Tracker server: http://localhost:${PORT}\n`);
});
