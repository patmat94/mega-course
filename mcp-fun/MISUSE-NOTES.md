# How the agent used the weather MCP server

## Setup

- Server: `src/index.ts`, a Cloudflare Worker named `mcp-fun`, deployed 2026-11-04 to `https://mcp-fun.patrykmatychniak.workers.dev/mcp`. It uses the Streamable HTTP transport, keeps no state and returns JSON only. Data comes from Open-Meteo, which needs no key.
- Tools:
  - `day_briefing` is the bundled tool. In one call it does geocoding (when given a place name), the forecast and air quality, so up to 3 upstream calls. It returns what to wear, whether to take an umbrella, the hours rain is likely, UV and air quality, and a `next_call` with ready arguments.
  - `hourly_window` returns hour-by-hour weather for one day and needs coordinates.
  - `find_place` returns place candidates. Its description says to use it only when a name is ambiguous.
- Connected with `claude mcp add --transport http weather-fun <url>` (local scope, project `mega-course`). `claude mcp list` showed `weather-fun ... ✔ Connected`.
- Agent: Claude Code 2.1.312, `claude -p`, model `claude-opus-5-5`. The flags were `--mcp-config mcp.json --strict-mcp-config`, with only the three weather tools allowed. Each run started in an empty scratch folder, so no repo CLAUDE.md or hooks applied. The prompts are in `runs/prompts.txt`, the full stream-json transcripts in `runs/01..06.jsonl`, and `node runs/extract.mjs runs/0*.jsonl` prints every call.

The notes below use the clean second batch (`runs/0*.jsonl`). The first batch is in `runs/bad-stdin/`. It is not counted, because the runner left stdin open and run 03 read the other prompts (its answer ends with "Your message also had five other questions"). Its one useful extra case is listed at the end.

## Misuses

Each entry has the run, the call that showed it, and what was wrong.

### 1. Wrong arguments: native place name, and the same bad value sent twice (run 05)

Prompt: "What's the weather like in Warszawa this weekend? Do I need an umbrella?"

```
#2 day_briefing {"place":"Warszawa","country_code":"PL","date":"2026-11-07"}  -> ERROR no place named "Warszawa"
#3 day_briefing {"place":"Warszawa","country_code":"PL","date":"2026-11-08"}  -> ERROR (same message)
#4 day_briefing {"place":"Warsaw","country_code":"PL","date":"2026-11-07"}
#5 day_briefing {"place":"Warsaw","country_code":"PL","date":"2026-11-08"}
```

- The agent passed the user's Polish spelling. The Open-Meteo geocoder has no "Warszawa" in PL (checked by hand: empty `results`), although "Kraków" works.
- It sent #2 and #3 together in one message, so the bad value went out twice before it saw any result.
- The agent fixed the spelling itself and skipped the error's hint ("try find_place"). That was the right choice here, because the hint was weak: it says "or a country_code", and a country code had already been given.
- After the fix, every `day_briefing` geocoded Warsaw again (2 extra geocoding calls). Calls sent in parallel cannot reuse coordinates from each other.
- Fixes on the server side: fall back to an endonym lookup or retry without diacritics; make the error say "country_code PL was given; try the English name 'Warsaw'"; let `day_briefing` take a date range.

### 2. Wrong argument source: coordinates from memory, not from a tool (run 02)

Prompt: "Will it rain during my commute in Kraków tomorrow between 8 and 9 am?"

```
TEXT "Kraków coordinates are well known (50.06, 19.94), so I'll call directly."
#2 hourly_window {"latitude":50.0647,"longitude":19.945,"date":"2026-11-05","from_hour":8,"to_hour":9}
```

- The `hourly_window` description says "take them from `day_briefing` or `find_place`". The agent made up the coordinates instead. They were close enough for a city, so the answer was right. For a small or ambiguous place the same habit would return weather for the wrong spot without any error.
- It saved a call, so this misuse is cheap.
- Fix: accept `place` in `hourly_window` too, or say in the description that coordinates from memory are not accepted.

### 3. Extra calls: fanned out over guesses instead of asking (run 03)

Prompt: "I want to go for a run in Springfield this evening. When will it be dry?"

```
#2 find_place {"name":"Springfield","count":5}  -> next_call day_briefing {37.21533,-93.29824}
#3 hourly_window {"latitude":37.21533,"longitude":-93.29824,"from_hour":16,"to_hour":22}   (Missouri)
#4 hourly_window {"latitude":39.80172,"longitude":-89.64371,...}                            (Illinois)
#5 hourly_window {"latitude":42.10148,"longitude":-72.58981,...}                            (Massachusetts)
#6 hourly_window {"latitude":39.92423,"longitude":-83.80882,...}                            (Ohio)
```

- The agent used `find_place` correctly for an ambiguous name. Then it queried 4 of the 5 candidates (#3–#6) and answered for all of them, instead of asking which Springfield or picking one.
- The result was 4 calls where 1 was needed.
- It ignored the `next_call` from `find_place` (`day_briefing` for the top candidate). That hint was also a poor fit, because the question was about one time window and `hourly_window` was the right tool.
- In the first batch the same prompt also fanned out (3 `hourly_window` calls after `find_place` with `count: 10`). So this is a pattern, not a one-off.
- Fix: when a name is ambiguous, `find_place` should return `next_call: ask the user` with the short list of names, not a call on candidate 1.

### 4. Hint ignored where it did not fit (runs 01, 04, 06)

Every `day_briefing` result carried `next_call: hourly_window 07–09` (the default when no rain is expected).

- Run 01 ("what should I wear in Warsaw today?") and run 04 (compare 3 cities: `#2 #3 #4 day_briefing`, one per city, which is correct) never followed it. That was right, since the question was already answered.
- Run 06 kept the tool and the coordinates from the hint but changed the hours to match the question:
  ```
  #2 day_briefing {"place":"Kraków","country_code":"PL"}  -> next_call hourly_window {50.06143,19.93658,"2026-11-04",7,9}
  #3 hourly_window {"latitude":50.06143,"longitude":19.93658,"date":"2026-11-04","from_hour":17,"to_hour":19}
  ```
  This is the intended use: the coordinates came from the hint, not from memory.
- These are not agent errors. They show that a `next_call` sent every time is noise. It should be sent only when a follow-up is likely (rain hours, an ambiguous place), or the result should say "no follow-up needed".

### 5. Extra call on every run: ToolSearch before the first tool use (all runs)

- Each run starts with `#1 ToolSearch {"query":"select:mcp__weather-fun__..."}`, because Claude Code defers MCP tool schemas.
- This is one extra round trip per session, caused by the harness and not by the server. Runs 01 and 04 loaded only `day_briefing`, which is the cheapest correct choice.

## What went right

- The bundled tool was chosen first whenever the question was about the day (runs 01, 04, 05, 06). Run 01 answered "what to wear" in 1 server call that made 3 upstream calls.
- The agent added `country_code: "PL"` unprompted in every Polish-city call.
- Run 06 noticed the limit of the data. It said the AQI was the day's maximum, not a live reading, and that the server has no hourly air data. This is a gap in the server, not a misuse.

## From the first (contaminated) batch only

`runs/bad-stdin/02.jsonl` shows the same Kraków prompt answered as `find_place {"name":"Kraków","country_code":"PL","count":1}`, then `hourly_window` with those coordinates. The `find_place` description says to use it only for ambiguous names, but this call was the correct way to get coordinates for `hourly_window`. The conflict is in the descriptions, not in the agent.
