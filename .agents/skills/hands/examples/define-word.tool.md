# Tool: define_word

A filled-in TOOL.md: a dictionary API wrapped as one MCP tool. Copy its shape; set your own numbers.

## Name

`define_word`

## Description

Look up an English word in a dictionary. Returns the word and its first senses, each with its part of speech, its definition and one example sentence when the dictionary has one. It does not translate, and it does not guess a spelling: a word the dictionary does not know comes back as an error.

## Input schema

The agent sends only the word. The tool asks the dictionary itself, so the dictionary's own answer never passes through the model.

```json input-schema
{
  "type": "object",
  "properties": {
    "word": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "One English word, such as harbour. A hyphenated word such as well-known counts as one."
    },
    "part_of_speech": {
      "type": "string",
      "enum": ["noun", "verb", "adjective", "adverb"],
      "description": "Only senses of this part of speech. Leave it out for every part of speech."
    },
    "senses": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5,
      "description": "How many senses to return, from 1 to 5. Default 3."
    }
  },
  "required": ["word"],
  "additionalProperties": false
}
```

## Output schema

The agent quotes a definition, or picks the sense that fits a sentence. So each sense has its part of speech, its definition and at most one example, nothing else. `more` tells the agent it can ask again for more senses.

```json output-schema
{
  "type": "object",
  "properties": {
    "word": { "type": "string", "description": "The word as the dictionary spells it." },
    "senses": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "part_of_speech": { "type": "string", "description": "noun, verb, adjective or adverb." },
          "definition": { "type": "string", "description": "The definition, trimmed." },
          "example": { "type": "string", "description": "One example sentence, when the dictionary has one." }
        },
        "required": ["part_of_speech", "definition"],
        "additionalProperties": false
      }
    },
    "more": { "type": "boolean", "description": "True when the dictionary has more senses than were returned." }
  },
  "required": ["word", "senses", "more"],
  "additionalProperties": false
}
```

A success for `{ "word": "harbour" }`, as the agent gets it. The text item holds the same JSON as `structuredContent`, compact.

```json
{
  "content": [{ "type": "text", "text": "<the structuredContent below, as compact JSON>" }],
  "structuredContent": {
    "word": "harbour",
    "senses": [
      { "part_of_speech": "noun", "definition": "A stretch of sheltered water on a coast where boats can stay safely.", "example": "The boats stayed in the harbour until the storm passed." },
      { "part_of_speech": "noun", "definition": "A place that gives shelter or protection." },
      { "part_of_speech": "verb", "definition": "To keep a feeling or an idea in your mind for a long time, often without saying so.", "example": "He still harbours doubts about the plan." }
    ],
    "more": true
  }
}
```

## Result budget

Budget: 1200 bytes for the whole result, measured on `{ "word": "harbour" }` with the default three senses. The result above is 1060 bytes as compact JSON: `structuredContent` 480, the text item 480, the rest 100.

What it leaves out to stay under: phonetic spellings, pronunciation links, word origins, synonyms and antonyms, every example after the first, the source links and the licence block. The dictionary's own answer for the same word carries all of them and runs to several KB. Each definition is trimmed, and the JSON is compact.

Big output: none. At most five senses come back, well under the budget. An agent that needs more asks for one part of speech at a time.

## Errors

| Field | Wrong call | Text the agent reads |
|---|---|---|
| `word` | a word the dictionary does not know | `word: "harbur" is not in the dictionary. Check the spelling, or send the word's base form, such as "run" for "running".` |
| `word` | more than one word | `word: "sea wall" is two words. Send one word; a hyphenated word such as well-known counts as one.` |
| `part_of_speech` | a part of speech the word does not have | `part_of_speech: "quickly" has no noun senses. It has: adverb. Send one of those, or leave part_of_speech out.` |
| `senses` | more than five | `senses: 12 is more than 5. Send a number from 1 to 5.` |
| none | the dictionary is busy (HTTP 429 or 5xx) | `No field is wrong: the dictionary is busy (HTTP 503). Send the same call again in 30 seconds.` |

The dictionary's own error message never reaches the agent alone. When it helps, it follows the line above in one short clause.

## Check

Both wrong samples pass the input schema and are wrong only in their value, so the tool itself has to catch them. The tool changes nothing outside this machine, so `sideEffects` is `false` and no stub is needed.

```json check
{
  "tool": "define_word",
  "budgetBytes": 1200,
  "sideEffects": false,
  "good": { "word": "harbour" },
  "wrong": [
    { "field": "word", "args": { "word": "harbur" } },
    { "field": "part_of_speech", "args": { "word": "quickly", "part_of_speech": "noun" } }
  ]
}
```
