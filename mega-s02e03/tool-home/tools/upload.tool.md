# Tool: upload

The contract for tool-home's upload. `npm run contracts` copies its name, description and schemas into `src/contracts.json`, which the server lists, so this file is the source. Change it first, then the code.

## Name

`upload`

## Description

Gives a link for a file to store on this server: PUT the file's raw bytes to upload_url, then share url, which anyone can open without signing in. The file itself never goes through the tool call.

## Input schema

The file's bytes never travel in the arguments (hands rule 4). The agent names the file; the bytes go by HTTP PUT, beside the model.

Ask: "Where does the input live, and can the tool reach it there?"
Answer: on the agent's disk, which this server cannot reach. So the server hands out a place to send the bytes. Source: the S02E03 debrief, "Getting a file from your disk to your server", and `mega-s02e03/log.txt:57`.

```json input-schema
{
  "type": "object",
  "properties": {
    "filename": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "description": "File name with its extension, such as notes.txt or clip.mp3. It ends the link, and sets the type when content_type is left out."
    },
    "content_type": {
      "type": "string",
      "maxLength": 200,
      "description": "MIME type, such as text/plain or audio/mpeg. Guessed from the file name when left out."
    }
  },
  "required": ["filename"],
  "additionalProperties": false
}
```

## Output schema

Ask: "What does the agent do with this result next?"
Answer: PUTs the bytes to upload_url, then gives url to someone. So the result is those two links and when the first one stops working.

```json output-schema
{
  "type": "object",
  "properties": {
    "url": { "type": "string", "format": "uri", "description": "Public link to the file on this server. It works once the PUT returns 200; anyone with it can open it." },
    "upload_url": { "type": "string", "format": "uri", "description": "Send the raw bytes here with one HTTP PUT, no sign-in header, once, up to 25 MB." },
    "expires_at": { "type": "string", "format": "date-time", "description": "When upload_url stops working, 15 minutes after this call." }
  },
  "required": ["url", "upload_url", "expires_at"],
  "additionalProperties": false
}
```

## Result budget

Budget: 1024 bytes for the whole result (`content` and `structuredContent`, as compact JSON), measured on the good sample below. The course caps a whole result at 1024 B (`mega-s02e03/log.txt:41`).

What it leaves out to stay under: the file id (it is in url), the file name and type (the agent sent them), the size (unknown until the PUT).

Big output: none. The file is the big part, and it goes by PUT, not through the model.

Ask: "What is the biggest input this tool will get?"
Answer: a 200-character file name; the file itself, up to 25 MB, never passes through the call. The course handed an 8.5 MB log (`mega-s02e03/log.txt:57`).

## Errors

| Field | Wrong call | Text the agent reads |
|---|---|---|
| `filename` | empty | `filename: shorter than 1 character. Send a name such as notes.txt.` |
| `content_type` | not a MIME type | `content_type: "<value>" is not a MIME type. Send one such as text/plain, or leave content_type out.` |
| `filename` | missing | `filename: required. Send a name such as notes.txt.` |
| any other | `content` or another argument the tool does not take | `content: not an argument of upload. Send only: filename, content_type; then PUT the bytes to upload_url.` |
| none | the server failed | `No field is wrong: upload failed on the server. Send the same call again in 1 minute.` |

Ask: "Which wrong call will an agent make most often?"
Answer: sending the file as content, as the tool took it before. That error says what to do instead. The check sends an empty filename, because content is not a field of the schema.

## Check

upload writes one row to tool-home's own database, on the server being checked, and to no other service. A link nobody PUTs to expires in 15 minutes, so `sideEffects` is `false`.

```json check
{
  "tool": "upload",
  "budgetBytes": 1024,
  "sideEffects": false,
  "good": { "filename": "check-tool.txt" },
  "wrong": [
    { "field": "filename", "args": { "filename": "" } },
    { "field": "content_type", "args": { "filename": "a.txt", "content_type": "not a type" } }
  ]
}
```

Run it through the signed-in stdio entry, from `mega-s02e03/tool-home`:

    node ../../.claude/skills/hands/scripts/check-tool.mjs --spec tools/upload.tool.md --cmd "node test/stdio-proxy.mjs http://127.0.0.1:8787"
