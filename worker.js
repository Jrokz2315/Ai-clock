/**
 * AI Clock - a request-time clock for browsers and AI readers.
 * No database, API key, upstream request, or scheduled job is needed.
 * This is a server-clock snapshot, not independently verified time.
 */

const DEFAULT_TIMEZONE = "America/New_York";
const SERVICE_VERSION = "1.0.1";
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,96}$/;
// Change this to a new private-to-your-test value, commit, and redeploy.
// It is a PUBLIC retrieval-test marker, never a password or API key.
const VERIFICATION_CODE = "clock-check-fresh-v101";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function calendarDay(dateOnly, difference) {
  // Shift a calendar label, not the request instant: safe across DST changes.
  const date = new Date(`${dateOnly}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + difference);
  return date.toISOString().slice(0, 10);
}

/** @param {Date} now @param {string} timeZone */
export function buildSnapshot(now, timeZone) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("A valid Date is required.");
  }
  if (typeof timeZone !== "string" || timeZone.length > 80 ||
      !/^[A-Za-z0-9_+\/-]+$/.test(timeZone)) {
    throw new RangeError("Invalid timezone.");
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  const offset = parts.timeZoneName === "GMT"
    ? "+00:00" : parts.timeZoneName.replace(/^GMT/, "");
  return {
    service: "AI Clock",
    service_version: SERVICE_VERSION,
    generated_at_utc: now.toISOString(),
    timezone: formatter.resolvedOptions().timeZone,
    today: date,
    weekday: parts.weekday,
    local_time_24h: time,
    utc_offset: offset,
    local_datetime: `${date}T${time}${offset}`,
    yesterday: calendarDay(date, -1),
    tomorrow: calendarDay(date, 1),
    unix_seconds: Math.floor(now.getTime() / 1000),
    verification_code: VERIFICATION_CODE,
    request_id: crypto.randomUUID(),
    clock_source: "Cloudflare Workers runtime clock",
    clock_verification: "Not independently checked against an external time authority.",
    timezone_source: "Explicit URL timezone or configured default; not device geolocation.",
    snapshot_note: "Time when this response was generated, not when a later reader sees it. Refetch for current time; indexed snippets may be stale.",
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function renderText(snapshot) {
  return Object.entries(snapshot)
    .map(([key, value]) => `${key}: ${value}`).join("\n") + "\n";
}

function renderHtml(snapshot) {
  const zone = encodeURIComponent(snapshot.timezone);
  // Keep request identity in format-switch links; never redirect to a bare URL.
  const nonce = snapshot.request_nonce !== "none"
    ? `&amp;nonce=${encodeURIComponent(snapshot.request_nonce)}` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Clock - current server time</title></head>
<body><main>
<h1>AI Clock</h1>
<p>Server-generated date and time. Reload this page for a new snapshot.
No browser-side JavaScript is required.</p>
<pre>${escapeHtml(renderText(snapshot))}</pre>
<p><a href="/time?tz=${zone}${nonce}">Plain text</a> |
<a href="/time.json?tz=${zone}${nonce}">JSON</a></p>
<p>The timezone is a setting, not a reading of the visitor's device location.
This clock is not independently checked against an external time authority.</p>
</main></body></html>`;
}

function response(request, body, status = 200, type = "text/plain", headers = {}) {
  return new Response(request.method === "HEAD" ? null : body, {
    status,
    headers: { ...NO_CACHE_HEADERS, "Content-Type": `${type}; charset=utf-8`, ...headers },
  });
}

export default {
  /** @param {Request} request @returns {Response} */
  fetch(request) {
    if (request.method === "OPTIONS") {
      return response(request, null, 204);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return response(request, "Method not allowed. Use GET or HEAD.\n", 405,
        "text/plain", { Allow: "GET, HEAD, OPTIONS" });
    }
    const url = new URL(request.url);
    if (url.pathname === "/robots.txt") {
      // Crawling is allowed, but live snapshots are marked noindex below.
      return response(request, "User-agent: *\nAllow: /\n");
    }
    if (url.pathname === "/favicon.ico") return response(request, null, 204);
    // A caller-chosen, never-reused token in the path gives each lookup a
    // distinct URL even if a reader ignores query strings. This is NOT
    // authentication or a cryptographic proof of freshness.
    const freshMatch = /^\/fresh\/([A-Za-z0-9_-]{16,96})\/?$/.exec(url.pathname);
    if (url.pathname.startsWith("/fresh") && !freshMatch) {
      return response(request,
        "Invalid fresh URL. Use /fresh/ followed by 16-96 letters, digits, hyphens, or underscores.\n", 400);
    }
    if (!["/", "/time", "/time.json"].includes(url.pathname) && !freshMatch) {
      return response(request, "Not found. Use /, /time, /time.json, or /fresh/<token>.\n", 404);
    }
    const queryNonces = url.searchParams.getAll("nonce");
    if (queryNonces.length > 1 ||
        (queryNonces.length === 1 && !NONCE_PATTERN.test(queryNonces[0]))) {
      return response(request,
        "Invalid nonce. Supply one value using 16-96 letters, digits, hyphens, or underscores.\n", 400);
    }
    const pathNonce = freshMatch?.[1];
    const queryNonce = queryNonces[0];
    if (pathNonce && queryNonce && pathNonce !== queryNonce) {
      return response(request, "Path and query nonces must match.\n", 400);
    }
    const requestNonce = pathNonce ?? queryNonce ?? "none";
    const format = url.searchParams.get("format") ??
      ((url.pathname === "/" || freshMatch) ? "html" : url.pathname === "/time.json" ? "json" : "text");
    if (!["text", "html", "json"].includes(format)) {
      return response(request, "Invalid format. Use text, html, or json.\n", 400);
    }
    try {
      // Read the runtime clock inside the handler, never at module startup.
      const snapshot = buildSnapshot(new Date(), url.searchParams.get("tz") ?? DEFAULT_TIMEZONE);
      // Echo only the validated routing token, never arbitrary request content.
      // The reader should compare it with the token it actually requested.
      snapshot.request_nonce = requestNonce;
      snapshot.request_nonce_source = pathNonce ? "path" : queryNonce ? "query" : "not supplied";
      const body = format === "json" ? JSON.stringify(snapshot, null, 2) + "\n"
        : format === "html" ? renderHtml(snapshot) : renderText(snapshot);
      const type = { text: "text/plain", html: "text/html", json: "application/json" }[format];
      // Avoid old clock values being advertised as search-index answers.
      // noindex does not require login or prevent direct URL retrieval.
      return response(request, body, 200, type, {
        "X-Robots-Tag": "noindex, noarchive",
        "X-AI-Clock-Version": SERVICE_VERSION,
        "X-AI-Clock-Request-Id": snapshot.request_id,
      });
    } catch (error) {
      if (error instanceof RangeError) {
        return response(request,
          "Invalid or unsupported timezone. Example: America/New_York or UTC.\n", 400);
      }
      return response(request, "Unable to generate a time snapshot.\n", 500);
    }
  },
};
