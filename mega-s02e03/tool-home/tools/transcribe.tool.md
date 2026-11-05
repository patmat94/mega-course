# Tool: transcribe

The contract for tool-home's transcribe. `npm run contracts` copies its name, description and schemas into `src/contracts.json`, which the server lists, so this file is the source. Change it first, then the code.

## Name

`transcribe`

## Description

Turns speech in an audio file at a public link into text segments, each with its start in seconds (Whisper). When the transcript does not fit 1 kB, the result holds the first segments and a link to the whole transcript. It does not translate.

## Input schema

The agent sends a link; the tool downloads the audio itself, so the audio never passes through the model (hands rule 4). A link reaches only the public internet or this server's own /files/ links (hands rule 9).

Ask: "Where does the input live, and can the tool reach it there?"
Answer: at a public link, or on this server after upload. Source: the S02E03 brief, `mega-s02e03/log.txt:10` ("transcribe {url} -> {segments:[{start,text,...}]} start in seconds").

```json input-schema
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri",
      "maxLength": 2000,
      "description": "Public http or https link to an audio file (mp3, wav, m4a, ogg, flac or webm), up to 25 MB, not on a private network. Example: https://example.com/talk.mp3."
    }
  },
  "required": ["url"],
  "additionalProperties": false
}
```

## Output schema

Ask: "What does the agent do with this result next?"
Answer: reads what was said and at what second, often to pull one value out of it (the S02E03 calibration clip holds "one clock time and one count", `mega-s02e03/log.txt:50`). So each segment is its start and its text; end times, language and duration are left out.

```json output-schema
{
  "type": "object",
  "properties": {
    "segments": {
      "type": "array",
      "description": "What was said, in order; only the first ones when omitted is set.",
      "items": {
        "type": "object",
        "properties": {
          "start": { "type": "number", "minimum": 0, "description": "Seconds from the start of the audio, rounded to 0.01." },
          "text": { "type": "string", "description": "What was said from that point." }
        },
        "required": ["start", "text"],
        "additionalProperties": false
      }
    },
    "omitted": { "type": "integer", "minimum": 1, "description": "Only when the transcript did not fit 1 kB: how many later segments are left out." },
    "transcript_url": { "type": "string", "format": "uri", "description": "Only with omitted: public link to the whole transcript as text, one line per segment, \"[start] text\"." },
    "transcript_bytes": { "type": "integer", "minimum": 1, "description": "Only with omitted: size of that text in bytes." }
  },
  "required": ["segments"],
  "additionalProperties": false
}
```

## Result budget

Budget: 1024 bytes for the whole result (`content` and `structuredContent`, as compact JSON), measured on the good sample below, the course's calibration clip. The course caps a whole result at 1024 B and measured transcribe on that clip (`mega-s02e03/log.txt:41`).

What it leaves out to stay under: end times, language, duration, Whisper's word timings and scores, and segments past the budget.

Big output: a transcript over the budget goes to a text file on this server (`/files/`). The result carries its link (`transcript_url`), its size (`transcript_bytes`), and the first segments that fit, which start with its first line.

Ask: "What is the biggest input this tool will get?"
Answer: 25 MB of audio, about an hour of speech; its transcript runs to tens of KB, so it goes to the file.

## Errors

| Field | Wrong call | Text the agent reads |
|---|---|---|
| `url` | a web page | `url: <link> is not audio: it returned text/html (a web page). Send a direct link to an audio file (mp3, wav, m4a, ogg, flac or webm) that opens without sign-in.` |
| `url` | an address on this machine or a private network | `url: <link> points to a private or local address. Send a public link to an audio file (...)` |
| `url` | 404 or 410 | `url: <link> was not found: the server answered HTTP 404. Send a link that opens, or check that the file still exists.` |
| `url` | 401 or 403 | `url: <link> is not public: the server answered HTTP 403. Send a direct link to an audio file (...)` |
| `url` | not http or https, or not a URL | `url: <value> is not an http or https link. Send a direct link to an audio file (...)` |
| `url` | over 25 MB | `url: <link> is 30.0 MB, over the 25.0 MB limit. Send a shorter recording, at most 25 MB.` |
| `url` | audio Whisper cannot read | `url: <link> could not be decoded as audio (... downloaded). Send a direct link to an audio file (...)` |
| `url` | the link did not answer | `url: <link> did not answer within 30 seconds. Send the same call again later, or a link on a faster host.` |
| `url` | more than 5 redirects | `url: <link> redirects more than 5 times. Send the final link of the audio file.` |
| none | the speech model failed | `No field is wrong: the speech model failed (<reason>). Send the same call again in 1 minute.` |

Ask: "Which wrong call will an agent make most often?"
Answer: a link to a web page instead of the audio file; the course sent exactly that (`mega-s02e03/log.txt:42`). It is first, and in the check below, with a local address (hands rule 9).

## Check

transcribe reads a public link and asks Workers AI; it changes nothing, so `sideEffects` is `false`. The good sample is the course's calibration clip.

```json check
{
  "tool": "transcribe",
  "budgetBytes": 1024,
  "sideEffects": false,
  "good": { "url": "https://hq.mega.dev/media/calibration/calibration-fdadf085.mp3" },
  "wrong": [
    { "field": "url", "args": { "url": "https://hq.mega.dev/login" } },
    { "field": "url", "args": { "url": "http://127.0.0.1/" } }
  ]
}
```

Run it through the signed-in stdio entry, from `mega-s02e03/tool-home`:

    node ../../.claude/skills/hands/scripts/check-tool.mjs --spec tools/transcribe.tool.md --cmd "node test/stdio-proxy.mjs http://127.0.0.1:8787"
