/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");
const SUPPORTED_PLATFORMS = new Set(["ios", "android"]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(platform, res, staticRoot = STATIC_ROOT) {
  // Keep the allow-list here as well as in the request handler so this helper
  // remains safe if another caller is added later.
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unsupported platform" }));
    return;
  }

  const manifestPath = resolveStaticPath(`${platform}/manifest.json`, staticRoot);

  if (!manifestPath) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * Resolve one URL path beneath STATIC_ROOT.
 *
 * URL.pathname is not decoded by WHATWG URL, so traversal payloads such as
 * `/%2e%2e/%2e%2e/secret` must be decoded before checking the filesystem
 * boundary. `path.resolve` + `path.relative` is used instead of a string
 * prefix check; the latter can incorrectly accept a sibling such as
 * `/static-build-backup`.
 *
 * Returns null for malformed encoding, NUL bytes, or paths outside the static
 * root. The root itself is returned for `/` and is subsequently rejected as a
 * directory by serveStaticFile.
 */
function resolveStaticPath(urlPath, staticRoot = STATIC_ROOT) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  if (decodedPath.includes("\0")) return null;

  // URL paths are rooted at `/`; remove only that URL-root marker before
  // resolving. Backslashes are included for Windows path separators.
  const relativePath = decodedPath.replace(/^[/\\]+/, "");
  const filePath = path.resolve(staticRoot, relativePath);
  const relative = path.relative(staticRoot, filePath);

  if (
    path.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
  ) {
    return null;
  }

  return filePath;
}

function serveStaticFile(urlPath, res, staticRoot = STATIC_ROOT) {
  const filePath = resolveStaticPath(urlPath, staticRoot);

  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "content-type": contentType });
  res.end(content);
}

function createServer({ staticRoot = STATIC_ROOT } = {}) {
  const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const appName = getAppName();

  return http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    let pathname = url.pathname;

    if (basePath && pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length) || "/";
    }

    if (pathname === "/manifest") {
      const platform = req.headers["expo-platform"];
      return serveManifest(platform, res, staticRoot);
    }

    if (pathname === "/") {
      const platform = req.headers["expo-platform"];
      if (SUPPORTED_PLATFORMS.has(platform)) {
        return serveManifest(platform, res, staticRoot);
      }

      return serveLandingPage(req, res, landingPageTemplate, appName);
    }

    serveStaticFile(pathname, res, staticRoot);
  });
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || "3000", 10);
  const server = createServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Serving static Expo build on port ${port}`);
  });
}

module.exports = { createServer, resolveStaticPath };
