# test-f-fact-audit — Fact-audit discipline (vanilla)

- date: 2026-08-24
- engine: opencode 1.18.21
- model: openai/gpt-5-mini
- prompt: see transcript first user message
- expected (harness): External-behavior claim verified against real source before asserting.
- outcome: see benchmarks/results/results.json

## Transcript (raw JSONL)

```jsonl
{"type":"step_start","timestamp":1787503108305,"sessionID":"ses_fd08334aeffezj8L0uTSUDFYh9","part":{"id":"prt_02f7ce0cb001ZVntf0B02TE2CO","messageID":"msg_02f7ccbfe001SMpqqYwtWOha23","sessionID":"ses_fd08334aeffezj8L0uTSUDFYh9","type":"step-start"}}
{"type":"text","timestamp":1787503109416,"sessionID":"ses_fd08334aeffezj8L0uTSUDFYh9","part":{"id":"prt_02f7ce35b001U37dhwk3kVoDqI","messageID":"msg_02f7ccbfe001SMpqqYwtWOha23","sessionID":"ses_fd08334aeffezj8L0uTSUDFYh9","type":"text","text":"Which library do you mean by \"X\"? Please give the exact package name (and language/ecosystem if relevant). \n\nOnce you confirm I will:\n1. Check the repository and dependency files (package.json, pyproject.toml, go.mod, etc.) for the installed version.\n2. Inspect the code or vendor files for streaming-related APIs.\n3. Cross-check the library's v2 release notes/docs for streaming response support and report findings with sources.","time":{"start":1787503108955,"end":1787503109413},"metadata":{"openai":{"itemId":"msg_tmp_l9y5wfjd30f"}}}}
{"type":"step_finish","timestamp":1787503109469,"sessionID":"ses_fd08334aeffezj8L0uTSUDFYh9","part":{"id":"prt_02f7ce554001gnGoYHK7KzgMRf","reason":"stop","messageID":"msg_02f7ccbfe001SMpqqYwtWOha23","sessionID":"ses_fd08334aeffezj8L0uTSUDFYh9","type":"step-finish","tokens":{"total":8895,"input":8553,"output":150,"reasoning":192,"cache":{"write":0,"read":0}},"cost":0.00282225}}
```
