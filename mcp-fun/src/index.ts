// mcp-fun: a small weather MCP server on a Cloudflare Worker.
// Streamable HTTP transport, stateless, JSON responses only (no SSE, no sessions).
// Data: Open-Meteo (geocoding, forecast, air quality), no API key.

const SERVER = { name: "mcp-fun-weather", version: "1.0.0" };
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const AIR = "https://air-quality-api.open-meteo.com/v1/air-quality";

type Json = Record<string, unknown>;

// ---------- tools ----------

const TOOLS = [
  {
    name: "day_briefing",
    title: "Day briefing: weather + what to wear",
    description:
      "One call for 'what is the day like and what should I wear': resolves the place, fetches the day's forecast and air quality, " +
      "and returns clothing advice, umbrella yes/no, rain hours, UV and air-quality notes. " +
      "Pass either `place` (a city name) or `latitude` + `longitude`. Prefer coordinates when you already have them. " +
      "The result has `next_call`: the suggested follow-up call with ready arguments.",
    inputSchema: {
      type: "object",
      properties: {
        place: { type: "string", description: "City name, e.g. 'Warsaw'. Ignored when latitude and longitude are given." },
        country_code: { type: "string", description: "ISO-3166 alpha-2 code to disambiguate `place`, e.g. 'PL'." },
        latitude: { type: "number" },
        longitude: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD, today up to 15 days ahead. Default: today in the place's time zone." },
      },
    },
  },
  {
    name: "hourly_window",
    title: "Hour-by-hour weather for a time window",
    description:
      "Hour-by-hour temperature, feels-like, rain chance, rain amount, wind and sky for one day between two local hours " +
      "(e.g. a commute or a run). Needs coordinates: take them from `day_briefing` or `find_place`.",
    inputSchema: {
      type: "object",
      properties: {
        latitude: { type: "number" },
        longitude: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD. Default: today in the place's time zone." },
        from_hour: { type: "integer", minimum: 0, maximum: 23, description: "First local hour, inclusive." },
        to_hour: { type: "integer", minimum: 0, maximum: 23, description: "Last local hour, inclusive." },
      },
      required: ["latitude", "longitude", "from_hour", "to_hour"],
    },
  },
  {
    name: "find_place",
    title: "Find a place",
    description:
      "Look up places by name and return candidates with coordinates, country and population. " +
      "Use it only when a name is ambiguous; `day_briefing` already resolves a city name by itself.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        country_code: { type: "string", description: "ISO-3166 alpha-2, e.g. 'PL'." },
        count: { type: "integer", minimum: 1, maximum: 10, default: 5 },
      },
      required: ["name"],
    },
  },
];

class ToolError extends Error {}

async function getJson(url: string): Promise<Json> {
  const r = await fetch(url, { headers: { "user-agent": "mcp-fun-weather/1.0" } });
  const body = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok || body.error) throw new ToolError(`upstream ${new URL(url).host}: ${body.reason ?? r.status}`);
  return body;
}

function qs(base: string, params: Record<string, string | number | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}

type Place = { name: string; country?: string; country_code?: string; admin1?: string; latitude: number; longitude: number; population?: number; timezone?: string };

async function geocode(name: string, countryCode?: string, count = 5): Promise<Place[]> {
  const body = await getJson(qs(GEO, { name, count, language: "en", format: "json", countryCode: countryCode?.toUpperCase() }));
  const results = (body.results as Json[] | undefined) ?? [];
  return results.map((p) => ({
    name: p.name as string,
    country: p.country as string | undefined,
    country_code: p.country_code as string | undefined,
    admin1: p.admin1 as string | undefined,
    latitude: p.latitude as number,
    longitude: p.longitude as number,
    population: p.population as number | undefined,
    timezone: p.timezone as string | undefined,
  }));
}

function checkDate(date: unknown): string | undefined {
  if (date === undefined || date === null || date === "") return undefined;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ToolError("date must be YYYY-MM-DD");
  return date;
}

function checkCoords(lat: unknown, lon: unknown): { latitude: number; longitude: number } {
  if (typeof lat !== "number" || typeof lon !== "number" || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    throw new ToolError("latitude and longitude must be numbers (lat -90..90, lon -180..180)");
  return { latitude: lat, longitude: lon };
}

const WMO: Record<number, string> = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "rime fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers",
  82: "violent showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
};
const sky = (code: number) => WMO[code] ?? `code ${code}`;

function wearFor(feelsMin: number, feelsMax: number, wet: boolean, windy: boolean, uv: number): string[] {
  const out: string[] = [];
  if (feelsMin < -10) out.push("winter coat, hat, gloves, scarf, thermal layer");
  else if (feelsMin < 0) out.push("winter coat, hat and gloves");
  else if (feelsMin < 8) out.push("warm jacket and a sweater");
  else if (feelsMin < 15) out.push("light jacket or a sweater");
  else if (feelsMin < 22) out.push("long sleeves or a t-shirt with a light layer");
  else out.push("t-shirt, light clothes");
  if (feelsMax - feelsMin >= 10) out.push(`layers: it goes from ${feelsMin}°C to ${feelsMax}°C (feels like)`);
  if (wet) out.push(feelsMin < 2 ? "waterproof boots" : "umbrella or a rain jacket");
  if (windy) out.push("windproof outer layer");
  if (uv >= 6) out.push("sunglasses and SPF 30+");
  else if (uv >= 3) out.push("sunglasses");
  return out;
}

async function dayBriefing(args: Json) {
  const date = checkDate(args.date);
  let place: Place | undefined;
  let alternatives: Place[] = [];
  let calls = 0;

  if (typeof args.latitude === "number" && typeof args.longitude === "number") {
    const c = checkCoords(args.latitude, args.longitude);
    place = { name: `${c.latitude},${c.longitude}`, ...c };
  } else if (typeof args.place === "string" && args.place.trim()) {
    const found = await geocode(args.place.trim(), args.country_code as string | undefined, 5);
    calls++;
    if (!found.length) throw new ToolError(`no place named "${args.place}"; try find_place with another spelling or a country_code`);
    // most populous match wins; others are reported
    const sorted = [...found].sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
    place = sorted[0];
    // a match is ambiguous only if another place is at least a tenth as big as the one picked
    const topPop = place.population ?? 0;
    alternatives = sorted.slice(1).filter((p) => (p.population ?? 0) >= topPop * 0.1 && (p.population ?? 0) > 0);
  } else {
    throw new ToolError("pass `place`, or `latitude` and `longitude`");
  }

  const window = date ? { start_date: date, end_date: date } : { forecast_days: 1 };
  const [fc, aq] = await Promise.all([
    getJson(qs(FORECAST, {
      latitude: place.latitude, longitude: place.longitude, timezone: "auto", ...window,
      daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset",
      hourly: "precipitation_probability,precipitation",
    })),
    getJson(qs(AIR, { latitude: place.latitude, longitude: place.longitude, timezone: "auto", ...window, hourly: "european_aqi,pm2_5" }))
      .catch((e: Error) => ({ error_text: e.message }) as Json),
  ]);
  calls += 2;

  const d = fc.daily as Record<string, (number | string)[]>;
  const h = fc.hourly as Record<string, (number | string | null)[]>;
  const day = d.time[0] as string;
  const n = (k: string) => Math.round(Number(d[k][0]) * 10) / 10;
  const rainHours: number[] = [];
  h.time.forEach((t, i) => {
    if (Number(h.precipitation_probability[i] ?? 0) >= 50 || Number(h.precipitation[i] ?? 0) >= 0.5) rainHours.push(Number(String(t).slice(11, 13)));
  });
  const wet = n("precipitation_probability_max") >= 40 || n("precipitation_sum") >= 1;
  const windy = n("wind_gusts_10m_max") >= 50;
  const uv = n("uv_index_max");

  let air: Json = { note: "no air-quality data for this date" };
  if (aq.hourly) {
    const vals = ((aq.hourly as Json).european_aqi as (number | null)[]).filter((v): v is number => v !== null);
    if (vals.length) {
      const max = Math.max(...vals);
      const label = max <= 20 ? "good" : max <= 40 ? "fair" : max <= 60 ? "moderate" : max <= 80 ? "poor" : max <= 100 ? "very poor" : "extremely poor";
      air = { european_aqi_max: max, label, advice: max > 60 ? "limit hard outdoor exercise; consider a mask" : "fine for outdoor activity" };
    }
  }

  const coords = { latitude: place.latitude, longitude: place.longitude };
  let next_call: Json;
  if (rainHours.length) {
    const from = Math.max(0, rainHours[0] - 1), to = Math.min(23, rainHours[rainHours.length - 1] + 1);
    next_call = {
      tool: "hourly_window",
      arguments: { ...coords, date: day, from_hour: from, to_hour: to },
      why: `rain is likely around ${rainHours[0]}:00-${rainHours[rainHours.length - 1]}:00; this shows when exactly it starts and stops`,
    };
  } else {
    next_call = {
      tool: "hourly_window",
      arguments: { ...coords, date: day, from_hour: 7, to_hour: 9 },
      why: "no rain expected; use this for a specific time like a commute or a run (change from_hour/to_hour)",
    };
  }
  if (alternatives.length) {
    next_call = {
      tool: "find_place",
      arguments: { name: args.place, count: 5 },
      why: `"${args.place}" matched several places; picked ${place.name}, ${place.country}. If that is wrong, pick the right one and call day_briefing with its latitude/longitude`,
      otherwise: next_call,
    };
  }

  return {
    place: { name: place.name, country: place.country, region: place.admin1, ...coords, timezone: fc.timezone },
    date: day,
    sky: sky(Number(d.weather_code[0])),
    temperature_c: { min: n("temperature_2m_min"), max: n("temperature_2m_max"), feels_min: n("apparent_temperature_min"), feels_max: n("apparent_temperature_max") },
    rain: { chance_max_pct: n("precipitation_probability_max"), total_mm: n("precipitation_sum"), likely_hours: rainHours, umbrella: wet },
    wind: { max_kmh: n("wind_speed_10m_max"), gusts_kmh: n("wind_gusts_10m_max") },
    uv_index_max: uv,
    sun: { rise: String(d.sunrise[0]).slice(11), set: String(d.sunset[0]).slice(11) },
    air_quality: air,
    wear: wearFor(n("apparent_temperature_min"), n("apparent_temperature_max"), wet, windy, uv),
    ...(alternatives.length ? { other_matches: alternatives.map((p) => ({ name: p.name, country: p.country, region: p.admin1, latitude: p.latitude, longitude: p.longitude })) } : {}),
    upstream_calls: calls,
    next_call,
  };
}

async function hourlyWindow(args: Json) {
  const c = checkCoords(args.latitude, args.longitude);
  const date = checkDate(args.date);
  const from = Number(args.from_hour), to = Number(args.to_hour);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 23 || from > to)
    throw new ToolError("from_hour and to_hour must be whole hours 0..23 with from_hour <= to_hour");
  const fc = await getJson(qs(FORECAST, {
    ...c, timezone: "auto", ...(date ? { start_date: date, end_date: date } : { forecast_days: 1 }),
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,weather_code",
  }));
  const h = fc.hourly as Record<string, (number | string)[]>;
  const hours = h.time
    .map((t, i) => ({ i, hour: Number(String(t).slice(11, 13)) }))
    .filter(({ hour }) => hour >= from && hour <= to)
    .map(({ i, hour }) => ({
      hour: `${String(hour).padStart(2, "0")}:00`,
      temp_c: h.temperature_2m[i], feels_c: h.apparent_temperature[i],
      rain_pct: h.precipitation_probability[i], rain_mm: h.precipitation[i],
      wind_kmh: h.wind_speed_10m[i], sky: sky(Number(h.weather_code[i])),
    }));
  const dry = hours.filter((x) => Number(x.rain_pct) < 30 && Number(x.rain_mm) < 0.2).map((x) => x.hour);
  return {
    date: String(h.time[0]).slice(0, 10),
    timezone: fc.timezone,
    hours,
    dry_hours: dry,
    next_call: {
      tool: "day_briefing",
      arguments: { ...c, date: String(h.time[0]).slice(0, 10) },
      why: "only if the user also wants the whole-day summary or clothing advice; for another time window on the same day, call hourly_window again with new hours",
    },
  };
}

async function findPlace(args: Json) {
  if (typeof args.name !== "string" || !args.name.trim()) throw new ToolError("name is required");
  const count = Math.min(10, Math.max(1, Number(args.count ?? 5) || 5));
  const found = await geocode(args.name.trim(), args.country_code as string | undefined, count);
  if (!found.length) throw new ToolError(`no place named "${args.name}"`);
  return {
    candidates: found,
    next_call: {
      tool: "day_briefing",
      arguments: { latitude: found[0].latitude, longitude: found[0].longitude },
      why: "use the latitude/longitude of the candidate the user means (not the place name again)",
    },
  };
}

const HANDLERS: Record<string, (a: Json) => Promise<unknown>> = {
  day_briefing: dayBriefing,
  hourly_window: hourlyWindow,
  find_place: findPlace,
};

// ---------- JSON-RPC / MCP ----------

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Json };

async function handleRpc(msg: Rpc, log: Json[]): Promise<Json | null> {
  const id = msg.id;
  const isNotification = id === undefined;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions:
          "Weather tools. For 'what is the weather / what should I wear' call day_briefing once; it already resolves the place. " +
          "Every result carries next_call with ready arguments; follow it instead of building a new call.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Json;
      const handler = HANDLERS[name];
      if (!handler) return err(-32602, `unknown tool: ${name}`);
      log.push({ tool: name, args });
      try {
        const result = await handler(args);
        return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
      } catch (e) {
        const message = e instanceof ToolError ? e.message : `internal error: ${(e as Error).message}`;
        log.push({ tool: name, error: message });
        return ok({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      if (isNotification) return null;
      return err(-32601, `method not found: ${msg.method}`);
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(`${SERVER.name} ${SERVER.version}: MCP endpoint at /mcp (Streamable HTTP)\n`, { headers: { "content-type": "text/plain" } });
    }
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
    if (req.method === "GET") return new Response("SSE stream not supported; POST JSON-RPC here", { status: 405, headers: { allow: "POST, DELETE" } });
    if (req.method === "DELETE") return new Response(null, { status: 405 });
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
    }
    const batch = Array.isArray(body);
    const msgs = (batch ? body : [body]) as Rpc[];
    const log: Json[] = [];
    const replies = (await Promise.all(msgs.map((m) => handleRpc(m, log)))).filter((r): r is Json => r !== null);
    // one log line per request, visible in `wrangler tail` (used to spot misuse)
    if (log.length) console.log(JSON.stringify({ at: new Date().toISOString(), calls: log }));
    if (!replies.length) return new Response(null, { status: 202 });
    return Response.json(batch ? replies : replies[0]);
  },
};
