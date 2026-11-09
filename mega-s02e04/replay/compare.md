|  | original | replay |
|---|---|---|
| model | claude-opus-5-5 | claude-opus-5-5 |
| cost USD (-p JSON) | 0.2920 | 0.2826 |
| assistant messages | 6 | 6 |
| num_turns (-p JSON) | 6 | 6 |
| tool calls, total | 5 | 5 |
|   ToolSearch | 1 | 1 |
|   mcp__job1__search | 1 | 1 |
|   mcp__job1__read | 1 | 1 |
|   mcp__job1__redact | 1 | 1 |
|   mcp__job1__submit | 1 | 1 |
| input tokens | 14 | 14 |
| output tokens | 2987 | 1810 |
| cache read tokens | 268604 | 293448 |
| cache write tokens | 22306 | 23452 |
| wall seconds (transcript) | 32.4 | 27.4 |
| API seconds (-p JSON) | 26.5 | 19.7 |

original: tool order ToolSearch > mcp__job1__search > mcp__job1__read > mcp__job1__redact > mcp__job1__submit; transcript C:\Users\p.matychniak\.claude\projects\C--Users-p-matychniak-Repos-mega-course-mega-s02e04\25e684bf-4ff5-4335-a4d0-5ef6789c396b.jsonl
replay: tool order ToolSearch > mcp__job1__search > mcp__job1__read > mcp__job1__redact > mcp__job1__submit; transcript C:\Users\p.matychniak\.claude\projects\C--Users-p-matychniak-Repos-mega-course-mega-s02e04\400a846f-0ec7-40ac-ab24-e54d9c4c0652.jsonl
