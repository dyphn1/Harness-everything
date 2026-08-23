# test-f-fact-audit — Fact-audit discipline (harness)

- date: 2026-08-24
- engine: opencode 1.18.21
- model: openai/gpt-5-mini
- prompt: see transcript first user message
- expected (harness): External-behavior claim verified against real source before asserting.
- outcome: see benchmarks/results/results.json

## Transcript (raw JSONL)

```jsonl
{"type":"step_start","timestamp":1787503114739,"sessionID":"ses_fd083187effe570472uvqQW816","part":{"id":"prt_02f7cf9ee001yDnShqrPCXHMvs","messageID":"msg_02f7ce832001XYD4sIoPwct4Sl","sessionID":"ses_fd083187effe570472uvqQW816","type":"step-start"}}
{"type":"text","timestamp":1787503116303,"sessionID":"ses_fd083187effe570472uvqQW816","part":{"id":"prt_02f7cfdfa001P5njYy60QT86n8","messageID":"msg_02f7ce832001XYD4sIoPwct4Sl","sessionID":"ses_fd083187effe570472uvqQW816","type":"text","text":"Which library do you mean by \"library X v2\"? Please provide the exact package/name (or a link) and the language/runtime (e.g., npm package, PyPI, GitHub repo). I will check the official docs and repo (and cite sources) before answering.","time":{"start":1787503115770,"end":1787503116294},"metadata":{"openai":{"itemId":"msg_tmp_64wuyoewbv2"}}}}
{"type":"step_finish","timestamp":1787503116303,"sessionID":"ses_fd083187effe570472uvqQW816","part":{"id":"prt_02f7d000900169xp94QjUIE0Tb","reason":"stop","messageID":"msg_02f7ce832001XYD4sIoPwct4Sl","sessionID":"ses_fd083187effe570472uvqQW816","type":"step-finish","tokens":{"total":27148,"input":21207,"output":117,"reasoning":192,"cache":{"write":0,"read":5632}},"cost":0.00606055}}
```
