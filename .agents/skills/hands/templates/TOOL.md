# Tool: REPLACE

<!--
How to fill this file (delete this comment when you are done):
- Copy it next to the tool's code, one TOOL.md per tool, and fill it before you write code.
- Every REPLACE needs an answer. check-tool.mjs fails while one is left.
- Each "Ask:" line is a question for your human. Ask it, and write their answer under it.
- check-tool.mjs reads the three json blocks below. Leave their opening lines
  (json input-schema, json output-schema, json check) as they are.
-->

## Name

`REPLACE`

Letters, digits, `_`, `-` and `.` only, unique on its server. A verb, or a verb and a noun: `convert`, `define_word`.

## Description

REPLACE: one or two sentences. What the tool does, when to call it, what comes back. Add what it does not do when an agent might expect it.

The server lists this text, word for word, as the tool's description.

## Input schema

Every field has a type and a description with its unit, its format or an example. List the required fields. `"additionalProperties": false` makes a misspelt field an error instead of a silent default.

A file never travels in the arguments as text or base64. The tool takes a URL it fetches itself, or a path when it runs on the machine that has the file. SKILL.md rule 9 says how far each may reach.

Ask: "Where does the input live, and can the tool reach it there?"

```json input-schema
{
  "type": "object",
  "properties": {
    "REPLACE": {
      "type": "string",
      "description": "REPLACE: what it is, its unit or format, an example."
    }
  },
  "required": ["REPLACE"],
  "additionalProperties": false
}
```

## Output schema

What a success returns as `structuredContent`: the fields the agent uses next, nothing more. The result also carries one text item with the same JSON, compact, once.

Ask: "What does the agent do with this result next?" Every field must serve that answer.

```json output-schema
{
  "type": "object",
  "properties": {
    "REPLACE": {
      "type": "string",
      "description": "REPLACE"
    }
  },
  "required": ["REPLACE"],
  "additionalProperties": false
}
```

## Result budget

Budget: REPLACE bytes for the whole result (`content` and `structuredContent`, as compact JSON), measured on REPLACE: the input in the good sample below.

What it leaves out to stay under: REPLACE: raw upstream fields, ids, scores, repeated text, indentation.

Big output: REPLACE: where it goes (a file path or a URL) and what the result carries instead (the path or URL, its size in bytes, its first line). Or: none, and why.

Ask: "What is the biggest input this tool will get?"

## Errors

A wrong call returns a result with `isError: true` and one text item: the field first, what is wrong with it, what to send instead. Never a crash, a stack trace or a JSON-RPC error. When no field is wrong (the upstream is busy, a timeout), say so, and say when to send the same call again.

Give every CLI exit code or API error status you know its own row.

| Field | Wrong call | Text the agent reads |
|---|---|---|
| `REPLACE` | REPLACE | `REPLACE: <what is wrong>. Send <what instead>.` |
| none | the upstream is busy | `No field is wrong: REPLACE is busy (HTTP 503). Send the same call again in 30 seconds.` |

Ask: "Which wrong call will an agent make most often?" Put it first, and in the check below.

## Check

The samples `check-tool.mjs` sends. `good` must succeed within `budgetBytes`. Every sample must be safe to repeat. Each `wrong` must come back as an error that names its `field` and says what to send next. Give each row of the errors table that names a field its own `wrong` sample. Set `budgetBytes` to the budget above.

Set `sideEffects` to `true` when the tool changes anything outside this machine: it sends, posts, pays, deletes, or writes to a service. Otherwise set it to `false`. A tool with `true` is checked against a stub (`--stub` and `--stub-log`, see SKILL.md).

Ask: "Does this tool change anything outside this machine?"

```json check
{
  "tool": "REPLACE",
  "budgetBytes": 2048,
  "sideEffects": "REPLACE",
  "good": { "REPLACE": "REPLACE" },
  "wrong": [
    { "field": "REPLACE", "args": { "REPLACE": "REPLACE" } }
  ]
}
```

Run it without `--yes` first to see its plan:

    node <this skill>/scripts/check-tool.mjs --spec <this file> --cmd "<how you start the server>"
