# Tool: memo_search

The contract for tool-home's memo_search. `npm run contracts` copies its name, description and schemas into `src/contracts.json`, which the server lists, so this file is the source. Change it first, then the code.

## Name

`memo_search`

## Description

Finds saved notes that contain every word of the query, newest first; an empty query returns the newest notes. The result stays under 1 kB: older matches are left out (omitted counts them) and one very long note is clipped (truncated), and hint says how to narrow the search.

## Input schema

Ask: "Where does the input live, and can the tool reach it there?"
Answer: the words are in the agent's context; the notes are in tool-home's database. Source: the S02E03 brief, `mega-s02e03/log.txt:10` ("memo_search {query}->{notes:[{id,text,...}]}").

```json input-schema
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "maxLength": 500,
      "description": "Words to look for, case-insensitive; a note matches when it holds every word. Empty matches every note. Example: \"meeting 14:00\"."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "description": "Most notes to return, from 1 to 100. Default 20. Fewer come back when they would not fit 1 kB."
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

## Output schema

Ask: "What does the agent do with this result next?"
Answer: reads the newest matching note, often to copy a code out of it (S02E03 noteA, `mega-s02e03/log.txt:68`). So each note has its text, its id, when and by whom it was saved; nothing else.

```json output-schema
{
  "type": "object",
  "properties": {
    "notes": {
      "type": "array",
      "description": "Matching notes, newest first.",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "description": "Id of the note." },
          "text": { "type": "string", "description": "The note text, or its start when truncated is true." },
          "created_at": { "type": "string", "format": "date-time", "description": "When it was saved, in UTC." },
          "source": { "type": "string", "description": "Name of the client that saved it." },
          "truncated": { "type": "boolean", "description": "Only when the text was clipped to fit 1 kB." }
        },
        "required": ["id", "text", "created_at", "source"],
        "additionalProperties": false
      }
    },
    "omitted": { "type": "integer", "minimum": 1, "description": "Only when older matching notes were left out to fit 1 kB: how many." },
    "hint": { "type": "string", "description": "Only when notes were left out or clipped: how to see the rest." }
  },
  "required": ["notes"],
  "additionalProperties": false
}
```

## Result budget

Budget: 1024 bytes for the whole result (`content` and `structuredContent`, as compact JSON), measured on the good sample below. The course caps a whole result at 1024 B (`mega-s02e03/log.txt:41`).

What it leaves out to stay under: older matches past the budget, the end of a note too long on its own, the client id, the row number. The server measures each candidate result before it answers, so a result never goes over.

Big output: none. Notes past the budget stay in the database; the agent narrows the query to reach them.

Ask: "What is the biggest input this tool will get?"
Answer: an empty query over every note; the live database held enough to make 2314 B before the budget (`mega-s02e03/log.txt:87`).

## Errors

| Field | Wrong call | Text the agent reads |
|---|---|---|
| `limit` | outside 1 to 100 | `limit: must be a whole number from 1 to 100. Send a number in that range, or leave limit out.` |
| `query` | missing | `query: required. Send query as a string; send "" for the newest notes.` |
| `query` | over 500 characters | `query: longer than 500 characters. Send at most 500.` |
| any other | an argument the tool does not take | `<name>: not an argument of memo_search. Send only: query, limit.` |
| none | the server failed | `No field is wrong: memo_search failed on the server. Send the same call again in 1 minute.` |

Ask: "Which wrong call will an agent make most often?"
Answer: a limit over 100. It is first, and in the check below.

## Check

memo_search only reads, so `sideEffects` is `false`.

```json check
{
  "tool": "memo_search",
  "budgetBytes": 1024,
  "sideEffects": false,
  "good": { "query": "" },
  "wrong": [
    { "field": "limit", "args": { "query": "x", "limit": 500 } }
  ]
}
```

Run it through the signed-in stdio entry, from `mega-s02e03/tool-home`:

    node ../../.claude/skills/hands/scripts/check-tool.mjs --spec tools/memo_search.tool.md --cmd "node test/stdio-proxy.mjs http://127.0.0.1:8787"
