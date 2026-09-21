// AI Clock - Cloudflare Worker
// Replace your existing Worker entry file with this code.
// Works as a self-contained module Worker.
//
// Primary endpoint:
//   /fresh/<16-32 character alphanumeric token>
//
// Alternate endpoint:
//   /clock/<16-32 character alphanumeric token>
//
// Example:
//   https://ai-clock.clopez-8eb.workers.dev/fresh/K7x9p2Lm4Q8r1Vz6
//
// The two clock routes intentionally return the same data through
// different URL paths so an AI client can retry through a second route.

const DEFAULT_TIMEZONE = "America/New_York";
const TOKEN_RE = /^[A-Za-z0-9]{16,32}$/;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Optional preflight support.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse("Method not allowed.\n", 405, {
        Allow: "GET, HEAD, OPTIONS",
      });
    }

    const parts = url.pathname.split("/").filter(Boolean);

    // Fresh clock routes.
    if (
      parts.length === 2 &&
      (parts[0] === "fresh" || parts[0] === "clock")
    ) {
      const routeName = parts[0];
      const token = parts[1];

      if (!TOKEN_RE.test(token)) {
        return textResponse(
          [
            "AI_CLOCK_ERROR",
            "error: invalid_token",
            "requirement: token must be 16-32 alphanumeric characters",
            `example: /fresh/K7x9p2Lm4Q8r1Vz6`,
            "END_AI_CLOCK_ERROR",
            "",
          ].join("\n"),
          400
        );
      }

      // The public endpoint defaults to America/New_York.
      // A valid ?tz= IANA timezone may be supplied for manual testing,
      // but Lumo should use the default URL with no timezone parameter.
      const requestedTimezone =
        url.searchParams.get("tz") || DEFAULT_TIMEZONE;

      const timezone = isValidTimezone(requestedTimezone)
        ? requestedTimezone
        : DEFAULT_TIMEZONE;

      const payload = buildClockPayload(token, timezone, routeName);
      const body = buildHtml(payload);

      const responseHeaders = {
        "Content-Type": "text/html; charset=utf-8",

        // Browser/proxy/CDN cache prevention.
        "Cache-Control":
          "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0",
        "CDN-Cache-Control": "no-store",
        "Cloudflare-CDN-Cache-Control": "no-store",
        "Surrogate-Control": "no-store",
        Pragma: "no-cache",
        Expires: "0",

        // Useful metadata. Lumo should still verify the visible body nonce.
        "X-Request-Nonce": payload.request_nonce,
        "X-Request-Id": payload.request_id,
        "X-Generated-At-UTC": payload.generated_at_utc,
        "X-AI-Clock-Route": routeName,

        // Keep the endpoint easy for tools to read.
        ...corsHeaders(),

        // Avoid indexing or archived copies being treated as live clock pages.
        "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      };

      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: responseHeaders,
        });
      }

      return new Response(body, {
        status: 200,
        headers: responseHeaders,
      });
    }

    // Basic health endpoint. It intentionally does not provide a clock value.
    if (url.pathname === "/health") {
      return textResponse(
        [
          "AI_CLOCK_HEALTH",
          "status: ok",
          "clock_endpoint: /fresh/<TOKEN>",
          "fallback_endpoint: /clock/<TOKEN>",
          "END_AI_CLOCK_HEALTH",
          "",
        ].join("\n"),
        200
      );
    }

    // Homepage: informational only.
    // Lumo should not use this as the normal clock source.
    if (url.pathname === "/" || url.pathname === "") {
      const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
  <title>AI Clock - current server time</title>
</head>
<body>
  <main>
    <h1>AI Clock</h1>

    <p>This homepage is informational only.</p>

    <p>For a fresh verifiable response, request:</p>

    <pre>/fresh/&lt;16-32-character-alphanumeric-token&gt;</pre>

    <p>Alternate retry route:</p>

    <pre>/clock/&lt;16-32-character-alphanumeric-token&gt;</pre>
  </main>
</body>
</html>`;

      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, max-age=0",
          "CDN-Cache-Control": "no-store",
          "Cloudflare-CDN-Cache-Control": "no-store",

          ...corsHeaders(),

          "X-Robots-Tag":
            "noindex, nofollow,noarchive,nosnippet",

          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return textResponse(
      [
        "AI_CLOCK_ERROR",
        "error: not_found",
        "clock_endpoint: /fresh/<TOKEN>",
        "fallback_endpoint: /clock/<TOKEN>",
        "END_AI_CLOCK_ERROR",
        "",
      ].join("\n"),
      404
    );
  },
};

function buildClockPayload(token, timezone, routeName) {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("en-US", {
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
  });

  const formattedParts = formatter.formatToParts(now);

  const value = (type) =>
    formattedParts.find((part) => part.type === type)?.value || "";

  const year = value("year");
  const month = value("month");
  const day = value("day");

  const hour = value("hour");
  const minute = value("minute");
  const second = value("second");

  const today = `${year}-${month}-${day}`;
  const localTime24h = `${hour}:${minute}:${second}`;

  const utcOffset = normalizeOffset(
    value("timeZoneName")
  );

  const localDatetime =
    `${today}T${localTime24h}${utcOffset}`;

  return {
    marker: "AI_CLOCK_FRESH_RESPONSE",

    request_nonce: token,
    request_nonce_repeat: token,

    today,
    weekday: value("weekday"),

    local_time_24h: localTime24h,

    timezone,
    utc_offset: utcOffset,

    local_datetime: localDatetime,

    generated_at_utc: now.toISOString(),

    unix_time_ms: String(now.getTime()),

    request_id: crypto.randomUUID(),

    route: routeName,

    fresh_response: "true",
  };
}

function buildHtml(payload) {
  // All required verification values are visible text.
  //
  // The nonce is deliberately shown near both the top
  // and bottom so extractors that trim page content are
  // less likely to omit it.

  const p = Object.fromEntries(
    Object.entries(payload).map(([key, val]) => [
      key,
      escapeHtml(String(val)),
    ])
  );

  return `<!doctype html>
<html lang="en">

<head>
  <meta charset="utf-8">

  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >

  <meta
    name="robots"
    content="noindex,nofollow,noarchive,nosnippet"
  >

  <meta
    http-equiv="Cache-Control"
    content="no-store, no-cache, must-revalidate, max-age=0"
  >

  <meta
    http-equiv="Pragma"
    content="no-cache"
  >

  <meta
    http-equiv="Expires"
    content="0"
  >

  <title>
    AI Clock Fresh Response - ${p.request_nonce}
  </title>
</head>

<body>

  <main>

    <h1>${p.marker}</h1>

    <p>
      <strong>request_nonce:</strong>
      ${p.request_nonce}
    </p>

    <p>
      <strong>fresh_response:</strong>
      ${p.fresh_response}
    </p>

    <pre>
request_nonce: ${p.request_nonce}
today: ${p.today}
weekday: ${p.weekday}
local_time_24h: ${p.local_time_24h}
timezone: ${p.timezone}
utc_offset: ${p.utc_offset}
local_datetime: ${p.local_datetime}
generated_at_utc: ${p.generated_at_utc}
unix_time_ms: ${p.unix_time_ms}
request_id: ${p.request_id}
route: ${p.route}
fresh_response: ${p.fresh_response}
request_nonce_repeat: ${p.request_nonce_repeat}
    </pre>

    <p>
      <strong>request_nonce_repeat:</strong>
      ${p.request_nonce_repeat}
    </p>

    <p>
      END_AI_CLOCK_FRESH_RESPONSE
    </p>

  </main>

</body>
</html>`;
}

function normalizeOffset(timeZoneName) {
  // Intl with timeZoneName:"longOffset"
  // normally returns:
  //
  // GMT-04:00
  // GMT-05:00
  // GMT+00:00

  if (!timeZoneName) {
    return "+00:00";
  }

  let value = timeZoneName
    .replace(/^GMT/, "")
    .trim();

  if (value === "" || value === "UTC") {
    return "+00:00";
  }

  // Normalize:
  // -4  -> -04:00
  // +5  -> +05:00

  const hourOnly =
    value.match(/^([+-])(\d{1,2})$/);

  if (hourOnly) {
    return (
      `${hourOnly[1]}` +
      `${hourOnly[2].padStart(2, "0")}` +
      `:00`
    );
  }

  // Normalize:
  // -4:00 -> -04:00

  const hourMinute =
    value.match(/^([+-])(\d{1,2}):(\d{2})$/);

  if (hourMinute) {
    return (
      `${hourMinute[1]}` +
      `${hourMinute[2].padStart(2, "0")}` +
      `:${hourMinute[3]}`
    );
  }

  // Already in desired form.
  if (/^[+-]\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  return value;
}

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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "GET, HEAD, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",
  };
}

function textResponse(
  body,
  status = 200,
  extraHeaders = {}
) {
  return new Response(body, {
    status,

    headers: {
      "Content-Type":
        "text/plain; charset=utf-8",

      "Cache-Control":
        "no-store, no-cache, must-revalidate, max-age=0",

      "CDN-Cache-Control":
        "no-store",

      "Cloudflare-CDN-Cache-Control":
        "no-store",

      Pragma:
        "no-cache",

      Expires:
        "0",

      ...corsHeaders(),

      ...extraHeaders,
    },
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
