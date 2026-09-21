const DEFAULT_TIMEZONE = "America/New_York";
const TOKEN_RE = /^[A-Za-z0-9]{16,32}$/;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // ---------------------------------------------------------
    // CORS preflight
    // ---------------------------------------------------------

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // ---------------------------------------------------------
    // Only GET / HEAD are supported
    // ---------------------------------------------------------

    if (request.method !== "GET" && request.method !== "HEAD") {
      return plainResponse(
        "error: method_not_allowed\n",
        405,
        {
          Allow: "GET, HEAD, OPTIONS",
        }
      );
    }

    const parts = url.pathname
      .split("/")
      .filter(Boolean);

    // =========================================================
    // LIVE CLOCK ENDPOINTS
    //
    // /fresh/TOKEN
    // /clock/TOKEN
    //
    // TOKEN must be 16-32 alphanumeric characters.
    // =========================================================

    if (
      parts.length === 2 &&
      (
        parts[0] === "fresh" ||
        parts[0] === "clock"
      )
    ) {
      const route = parts[0];
      const token = parts[1];

      // -------------------------------------------------------
      // Validate token
      // -------------------------------------------------------

      if (!TOKEN_RE.test(token)) {
        return plainResponse(
          [
            "AI_CLOCK_ERROR",
            "error: invalid_token",
            "requirement: token must be 16-32 alphanumeric characters",
            "example: /fresh/K7x9p2Lm4Q8r1Vz6",
            "END_AI_CLOCK_ERROR",
            "",
          ].join("\n"),
          400
        );
      }

      // -------------------------------------------------------
      // Timezone
      //
      // Defaults to America/New_York.
      // Optional ?tz= may be used for testing.
      // -------------------------------------------------------

      const requestedTimezone =
        url.searchParams.get("tz") ||
        DEFAULT_TIMEZONE;

      const timezone =
        isValidTimezone(requestedTimezone)
          ? requestedTimezone
          : DEFAULT_TIMEZONE;

      // -------------------------------------------------------
      // Generate the clock snapshot
      // -------------------------------------------------------

      const clock = buildClock(
        token,
        timezone,
        route
      );

      const body = buildPlainText(clock);
      const headers = clockHeaders(clock);

      // -------------------------------------------------------
      // HEAD request
      // -------------------------------------------------------

      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers,
        });
      }

      // -------------------------------------------------------
      // GET response
      // -------------------------------------------------------

      return new Response(body, {
        status: 200,
        headers,
      });
    }

    // =========================================================
    // HEALTH ENDPOINT
    // =========================================================

    if (url.pathname === "/health") {
      return plainResponse(
        [
          "AI_CLOCK_HEALTH",
          "status: ok",
          "primary_endpoint: /fresh/<TOKEN>",
          "fallback_endpoint: /clock/<TOKEN>",
          "default_timezone: America/New_York",
          "response_format: text/plain",
          "END_AI_CLOCK_HEALTH",
          "",
        ].join("\n"),
        200
      );
    }

    // =========================================================
    // ROOT / HOMEPAGE
    //
    // Informational only.
    // Lumo should NOT use this as the clock source.
    // =========================================================

    if (
      url.pathname === "/" ||
      url.pathname === ""
    ) {
      return plainResponse(
        [
          "AI CLOCK",
          "",
          "This homepage is informational only.",
          "",
          "Use a unique token for every request.",
          "",
          "Primary endpoint:",
          "/fresh/<16-32-character-alphanumeric-token>",
          "",
          "Fallback endpoint:",
          "/clock/<16-32-character-alphanumeric-token>",
          "",
          "Example:",
          "/fresh/K7x9p2Lm4Q8r1Vz6",
          "",
        ].join("\n"),
        200
      );
    }

    // =========================================================
    // NOT FOUND
    // =========================================================

    return plainResponse(
      [
        "AI_CLOCK_ERROR",
        "error: not_found",
        "primary_endpoint: /fresh/<TOKEN>",
        "fallback_endpoint: /clock/<TOKEN>",
        "END_AI_CLOCK_ERROR",
        "",
      ].join("\n"),
      404
    );
  },
};


// =============================================================
// BUILD CLOCK SNAPSHOT
// =============================================================

function buildClock(
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

  const localTime =
    `${hour}:${minute}:${second}`;

  const utcOffset =
    normalizeOffset(
      get("timeZoneName")
    );

  const localDatetime =
    `${today}T${localTime}${utcOffset}`;

  return {
    request_nonce: token,

    today,

    weekday:
      get("weekday"),

    local_time_24h:
      localTime,

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
// BUILD EXTRACTION-FRIENDLY RESPONSE
//
// IMPORTANT:
//
// This intentionally returns plain text.
//
// Do NOT change this to HTML.
// Do NOT put the fields in <pre>.
// Do NOT make JSON the primary response.
//
// The goal is to make all required fields visible to AI webpage
// extraction tools such as Lumo.
// =============================================================

function buildPlainText(clock) {
  return [
    "AI_CLOCK_FRESH_RESPONSE",

    "",

    // Nonce first so extraction systems see it immediately.
    `request_nonce: ${clock.request_nonce}`,

    // Required clock fields.
    `today: ${clock.today}`,
    `weekday: ${clock.weekday}`,
    `local_time_24h: ${clock.local_time_24h}`,
    `timezone: ${clock.timezone}`,
    `utc_offset: ${clock.utc_offset}`,
    `generated_at_utc: ${clock.generated_at_utc}`,

    // Supporting fields.
    `local_datetime: ${clock.local_datetime}`,
    `unix_time_ms: ${clock.unix_time_ms}`,
    `request_id: ${clock.request_id}`,
    `route: ${clock.route}`,
    `fresh_response: ${clock.fresh_response}`,

    "",

    // ---------------------------------------------------------
    // Compact duplicate snapshot
    //
    // This gives extraction systems a second representation of
    // the important data in case individual lines get omitted.
    // ---------------------------------------------------------

    (
      "clock_snapshot: " +
      `request_nonce=${clock.request_nonce}; ` +
      `date=${clock.today}; ` +
      `weekday=${clock.weekday}; ` +
      `time=${clock.local_time_24h}; ` +
      `timezone=${clock.timezone}; ` +
      `offset=${clock.utc_offset}; ` +
      `generated_at_utc=${clock.generated_at_utc}`
    ),

    "",

    // Repeat nonce near the end.
    `request_nonce_repeat: ${clock.request_nonce_repeat}`,

    "",

    "END_AI_CLOCK_FRESH_RESPONSE",

    "",
  ].join("\n");
}


// =============================================================
// HEADERS FOR LIVE CLOCK RESPONSES
// =============================================================

function clockHeaders(clock) {
  return {
    // ---------------------------------------------------------
    // Plain text is intentional.
    // ---------------------------------------------------------

    "Content-Type":
      "text/plain; charset=utf-8",

    // ---------------------------------------------------------
    // Aggressive cache prevention.
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
    // Lumo should still verify request_nonce from the body.
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
    // Security / compatibility
    // ---------------------------------------------------------

    "X-Content-Type-Options":
      "nosniff",

    "Referrer-Policy":
      "no-referrer",

    ...corsHeaders(),
  };
}


// =============================================================
// GENERIC PLAIN TEXT RESPONSE
// =============================================================

function plainResponse(
  body,
  status = 200,
  extraHeaders = {}
) {
  return new Response(
    body,
    {
      status,

      headers: {
        "Content-Type":
          "text/plain; charset=utf-8",

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

        "X-Content-Type-Options":
          "nosniff",

        ...corsHeaders(),

        ...extraHeaders,
      },
    }
  );
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
// Examples:
//
// GMT-04:00 -> -04:00
// GMT-05:00 -> -05:00
// GMT+00:00 -> +00:00
// GMT-4     -> -04:00
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

  // Example:
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

  // Example:
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

  // Already normalized.
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
