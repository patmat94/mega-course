# Tool: memo_write

The contract for tool-home's memo_write. `npm run contracts` copies its name, description and schemas into `src/contracts.json`, which the server lists, so this file is the source. Change it first, then the code.

## Name

`memo_write`

## Description

Saves a text note on this server and returns its id. Find it again with memo_search. It does not edit or delete notes.

## Input schema

The agent sends the note text itself: a note is short text, not a file. Up to 20,000 characters.

Ask: "Where does the input live, and can the tool reach it there?"
Answer: in the agent's context, as short text it wrote or was given. Source: the S02E03 brief, `mega-s02e03/log.txt:10` ("memo_write {text}->{id}").

```json input-schema
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "minLength": 1,
      "maxLength": 20000,
      "description": "The note, as plain text, 1 to 20,000 characters. Example: \"Meeting moved to 14:00.\""
    }
  },
  "required": ["text"],
  "additionalProperties": false
}
```

## Output schema

Ask: "What does the agent do with this result next?"
Answer: confirms the note is saved, and may quote its id. Source: the S02E03 brief, `mega-s02e03/log.txt:10`.

```json output-schema
{
  "type": "object",
  "properties": {
    "id": { "type": "string", "description": "Id of the saved note, such as memo_hLpsXpI7o8ix8iar." },
    "created_at": { "type": "string", "format": "date-time", "description": "When it was saved, in UTC." }
  },
  "required": ["id", "created_at"],
  "additionalProperties": false
}
```

## Result budget

Budget: 1024 bytes for the whole result (`content` and `structuredContent`, as compact JSON), measured on the good sample below. The course caps a whole result at 1024 B (`mega-s02e03/log.txt:41`).

What it leaves out to stay under: the note text, the client name, the row number.

Big output: none. The result is two short fields, about 340 bytes.

Ask: "What is the biggest input this tool will get?"
Answer: a note of 20,000 characters; the result does not grow with it.

## Errors

| Field | Wrong call | Text the agent reads |
|---|---|---|
| `text` | empty | `text: shorter than 1 character. Send at least 1.` |
| `text` | over 20,000 characters | `text: longer than 20000 characters. Send at most 20000.` |
| `text` | missing | `text: required. Send text as a string.` |
| any other | an argument the tool does not take | `<name>: not an argument of memo_write. Send only: text.` |
| none | the server failed | `No field is wrong: memo_write failed on the server. Send the same call again in 1 minute.` |

Ask: "Which wrong call will an agent make most often?"
Answer: an empty text. It is first, and in the check below.

## Check

memo_write writes to tool-home's own database, on the server being checked, and to no other service. A sample note per run is harmless, so `sideEffects` is `false`.

```json check
{
  "tool": "memo_write",
  "budgetBytes": 1024,
  "sideEffects": false,
  "good": { "text": "check-tool sample note" },
  "wrong": [
    { "field": "text", "args": { "text": "" } }
  ]
}
```

Run it through the signed-in stdio entry, from `mega-s02e03/tool-home`:

    node ../../.claude/skills/hands/scripts/check-tool.mjs --spec tools/memo_write.tool.md --cmd "node test/stdio-proxy.mjs http://127.0.0.1:8787"
