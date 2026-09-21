const DEFAULT_TIMEZONE = "America/New_York";
const TOKEN_RE = /^[A-Za-z0-9]{16,32}$/;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // =========================================================
    // CORS PREFLIGHT
    // =========================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // =========================================================
    // METHODS
    // =========================================================

    if (request.method !== "GET" && request.method !== "HEAD") {
      return htmlError(
        405,
        "method_not_allowed",
        "Only GET and HEAD are supported.",
        {
          Allow: "GET, HEAD, OPTIONS",
        }
      );
    }

    // Normalize trailing slash except root.
    let pathname = url.pathname;

    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    // =========================================================
    // LIVE CLOCK
    //
    // PRIMARY:
    // /time?nonce=TOKEN
    //
    // RETRY:
    // /time2?nonce=TOKEN
    //
    // Stable paths are intentional.
    // Only the query nonce changes.
    // =========================================================

    if (pathname === "/time" || pathname === "/time2") {
      const token = url.searchParams.get("nonce") || "";

      if (!TOKEN_RE.test(token)) {
        return htmlError(
          400,
          "invalid_nonce",
          "nonce must contain 16-32 alphanumeric characters."
        );
      }

      const requestedTimezone =
        url.searchParams.get("tz") || DEFAULT_TIMEZONE;

      const timezone = isValidTimezone(requestedTimezone)
        ? requestedTimezone
        : DEFAULT_TIMEZONE;

      const route =
        pathname === "/time"
          ? "time"
          : "time2";

      const snapshot = buildClockSnapshot(
        token,
        timezone,
        route
      );

      const body = renderClockHtml(snapshot);
      const headers = clockHeaders(snapshot);

      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers,
        });
      }

      return new Response(body, {
        status: 200,
        headers,
      });
    }

    // =========================================================
    // HEALTH CHECK
    // =========================================================

    if (pathname === "/health") {
      const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AI Clock Health</title>
</head>
<body>
<h1>AI Clock Health</h1>
<p>status: ok</p>
<p>primary_endpoint: /time?nonce=TOKEN</p>
<p>retry_endpoint: /time2?nonce=TOKEN</p>
<p>default_timezone: America/New_York</p>
<p>response_format: text/html</p>
</body>
</html>`;

      return new Response(body, {
        status: 200,
        headers: basicHeaders(),
      });
    }

    // =========================================================
    // ROOT
    //
    // Informational only.
    // Do not use root as the live clock source.
    // =========================================================

    if (pathname === "/") {
      const body = `<!doctype html>
<html lang="en">

<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Clock</title>
</head>

<body>

<main>

<h1>AI Clock</h1>

<p>
This service provides a fresh, nonce-verifiable server timestamp.
</p>

<h2>Primary endpoint</h2>

<p>
/time?nonce=&lt;16-32-character-alphanumeric-token&gt;
</p>

<h2>Retry endpoint</h2>

<p>
/time2?nonce=&lt;16-32-character-alphanumeric-token&gt;
</p>

<h2>Example</h2>

<p>
/time?nonce=K7x9p2Lm4Q8r1Vz6
</p>

<p>
The returned request_nonce must exactly match the requested nonce.
</p>

</main>

</body>
</html>`;

      return new Response(body, {
        status: 200,
        headers: basicHeaders(),
      });
    }

    // =========================================================
    // 404
    // =========================================================

    return htmlError(
      404,
      "not_found",
      "Use /time?nonce=TOKEN"
    );
  },
};


// =============================================================
// BUILD CLOCK SNAPSHOT
// =============================================================

function buildClockSnapshot(
  token,
  timezone,
  route
) {
  const now = new Date();

  const formatter =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: timezone,

        year: "numeric",
        month: "2-digit",
        day: "2-digit",

        weekday: "long",

        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",

        hourCycle: "h23",

        timeZoneName: "longOffset",
      }
    );

  const parts =
    formatter.formatToParts(now);

  const get = (type) =>
    parts.find(
      (part) => part.type === type
    )?.value || "";

  const year = get("year");
  const month = get("month");
  const day = get("day");

  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");

  const today =
    `${year}-${month}-${day}`;

  const localTime24h =
    `${hour}:${minute}:${second}`;

  const utcOffset =
    normalizeOffset(
      get("timeZoneName")
    );

  const localDatetime =
    `${today}T${localTime24h}${utcOffset}`;

  return {
    request_nonce: token,

    today,

    weekday:
      get("weekday"),

    local_time_24h:
      localTime24h,

    timezone,

    utc_offset:
      utcOffset,

    generated_at_utc:
      now.toISOString(),

    local_datetime:
      localDatetime,

    unix_time_ms:
      String(now.getTime()),

    request_id:
      crypto.randomUUID(),

    route,

    fresh_response:
      "true",

    request_nonce_repeat:
      token,
  };
}


// =============================================================
// RENDER CLOCK HTML
//
// IMPORTANT:
//
// Everything Lumo needs is ordinary visible HTML text.
//
// Do NOT:
// - convert this to text/plain
// - put fields inside <pre>
// - return JSON
// - hide fields in JavaScript
// - add nosnippet
// - add noindex
//
// The goal is maximum compatibility with webpage extractors.
// =============================================================

function renderClockHtml(clock) {
  const c =
    Object.fromEntries(
      Object.entries(clock).map(
        ([key, value]) => [
          key,
          escapeHtml(String(value)),
        ]
      )
    );

  return `<!doctype html>

<html lang="en">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1"
>

<title>
AI Clock ${c.request_nonce}
</title>

</head>

<body>

<main>

<h1>
AI CLOCK CURRENT TIME
</h1>


<p>
request_nonce: ${c.request_nonce}
</p>


<p>
today: ${c.today}
</p>


<p>
weekday: ${c.weekday}
</p>


<p>
local_time_24h: ${c.local_time_24h}
</p>


<p>
timezone: ${c.timezone}
</p>


<p>
utc_offset: ${c.utc_offset}
</p>


<p>
generated_at_utc: ${c.generated_at_utc}
</p>


<p>
local_datetime: ${c.local_datetime}
</p>


<p>
unix_time_ms: ${c.unix_time_ms}
</p>


<p>
request_id: ${c.request_id}
</p>


<p>
route: ${c.route}
</p>


<p>
fresh_response: ${c.fresh_response}
</p>


<h2>
Clock snapshot
</h2>


<p>
clock_snapshot:
request_nonce=${c.request_nonce};
today=${c.today};
weekday=${c.weekday};
local_time_24h=${c.local_time_24h};
timezone=${c.timezone};
utc_offset=${c.utc_offset};
generated_at_utc=${c.generated_at_utc};
request_id=${c.request_id}
</p>


<h2>
Verification
</h2>


<p>
The request nonce for this response is
${c.request_nonce}.
</p>


<p>
request_nonce_repeat: ${c.request_nonce_repeat}
</p>


<p>
END_AI_CLOCK_RESPONSE
</p>

</main>

</body>

</html>`;
}


// =============================================================
// LIVE CLOCK HEADERS
// =============================================================

function clockHeaders(clock) {
  return {
    "Content-Type":
      "text/html; charset=utf-8",

    "Content-Language":
      "en-US",

    // ---------------------------------------------------------
    // Prevent intermediary caching.
    // ---------------------------------------------------------

    "Cache-Control":
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0",

    "CDN-Cache-Control":
      "no-store",

    "Cloudflare-CDN-Cache-Control":
      "no-store",

    "Surrogate-Control":
      "no-store",

    "Pragma":
      "no-cache",

    "Expires":
      "0",

    // ---------------------------------------------------------
    // Supporting verification headers.
    //
    // The visible BODY nonce remains the main validation field
    // because webpage extractors may not expose HTTP headers.
    // ---------------------------------------------------------

    "X-Request-Nonce":
      clock.request_nonce,

    "X-Request-Id":
      clock.request_id,

    "X-Generated-At-UTC":
      clock.generated_at_utc,

    "X-AI-Clock-Route":
      clock.route,

    // ---------------------------------------------------------
    // Basic security headers.
    //
    // Intentionally NO X-Robots-Tag here.
    // ---------------------------------------------------------

    "X-Content-Type-Options":
      "nosniff",

    "Referrer-Policy":
      "no-referrer",

    ...corsHeaders(),
  };
}


// =============================================================
// NORMAL PAGE HEADERS
// =============================================================

function basicHeaders() {
  return {
    "Content-Type":
      "text/html; charset=utf-8",

    "Content-Language":
      "en-US",

    "Cache-Control":
      "no-store, no-cache, must-revalidate, max-age=0, s-maxage=0",

    "CDN-Cache-Control":
      "no-store",

    "Cloudflare-CDN-Cache-Control":
      "no-store",

    "Pragma":
      "no-cache",

    "Expires":
      "0",

    "X-Content-Type-Options":
      "nosniff",

    ...corsHeaders(),
  };
}


// =============================================================
// HTML ERROR
// =============================================================

function htmlError(
  status,
  error,
  message,
  extraHeaders = {}
) {
  const safeError =
    escapeHtml(String(error));

  const safeMessage =
    escapeHtml(String(message));

  const body = `<!doctype html>

<html lang="en">

<head>
<meta charset="utf-8">
<title>AI Clock Error</title>
</head>

<body>

<h1>
AI CLOCK ERROR
</h1>

<p>
error: ${safeError}
</p>

<p>
message: ${safeMessage}
</p>

<p>
primary_endpoint: /time?nonce=TOKEN
</p>

<p>
retry_endpoint: /time2?nonce=TOKEN
</p>

</body>

</html>`;

  return new Response(body, {
    status,

    headers: {
      ...basicHeaders(),
      ...extraHeaders,
    },
  });
}


// =============================================================
// TIMEZONE VALIDATION
// =============================================================

function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: timezone,
      }
    ).format();

    return true;
  } catch {
    return false;
  }
}


// =============================================================
// UTC OFFSET NORMALIZATION
//
// Possible Intl values include:
//
// GMT-04:00
// GMT-05:00
// GMT+00:00
// GMT-4
//
// Desired:
//
// -04:00
// -05:00
// +00:00
// =============================================================

function normalizeOffset(
  timeZoneName
) {
  if (!timeZoneName) {
    return "+00:00";
  }

  let value =
    timeZoneName
      .replace(/^GMT/, "")
      .trim();

  if (
    value === "" ||
    value === "UTC"
  ) {
    return "+00:00";
  }

  // -4 -> -04:00

  const hourOnly =
    value.match(
      /^([+-])(\d{1,2})$/
    );

  if (hourOnly) {
    return (
      hourOnly[1] +
      hourOnly[2]
        .padStart(2, "0") +
      ":00"
    );
  }

  // -4:00 -> -04:00

  const hourMinute =
    value.match(
      /^([+-])(\d{1,2}):(\d{2})$/
    );

  if (hourMinute) {
    return (
      hourMinute[1] +
      hourMinute[2]
        .padStart(2, "0") +
      ":" +
      hourMinute[3]
    );
  }

  if (
    /^[+-]\d{2}:\d{2}$/
      .test(value)
  ) {
    return value;
  }

  return value;
}


// =============================================================
// CORS
// =============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET, HEAD, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",

    "Access-Control-Expose-Headers":
      "X-Request-Nonce, X-Request-Id, X-Generated-At-UTC, X-AI-Clock-Route",
  };
}


// =============================================================
// HTML ESCAPE
// =============================================================

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
