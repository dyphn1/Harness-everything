---
id: E-0029
signature: live-probe-shadowed-by-installed-plugin
class: environment
title: "A live host probe loaded the machine's installed Harness plugin instead of the candidate under test"
sites:
  - opencode-plugin/index.mjs
  - "OpenCode global plugin shim (user config)"
  - "Codex user-hook compatibility runtime (user config)"
violates: "#394 owner direction acceptance 3: Prove model-visible delivery on real hosts with retained capture and version/SHA"
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 501-opencode-codex-live-capture
    feature: "#394 live capture (PR #501)"
    date: 2026-11-21
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator live probe
        result: "OpenCode 2.1.4: a project-scope copy of the candidate plugin loaded, but the globally installed Harness plugin has the same id and a long-running opencode serve kept the global one, so no candidate hook fired. Codex: the user's compat hooks run a pinned 0.55.2 runtime. Changing either is a user-config change the permission classifier refused; both live rows stay UNCHECKED."
---

## Cue

Planning a live capture of a Harness hook on a machine that already has Harness installed for that host.

## What happened

The candidate was loaded next to the installed copy. On OpenCode the installed plugin (same id) won, so the probe exercised old code and showed nothing; it looked like a delivery failure until the server log and an instrumented copy showed the candidate's hooks never ran.

## Lesson

- Before a live probe, list what the host will load (global plugins, user hooks, long-running servers) and how ids collide.
- Prefer a host instance with isolated config and data, or capture after merge when the installed copy tracks the main checkout.
- A silent probe is not evidence of a delivery bug until the candidate's own hook is shown to run.

## Evidence

- PR #501 comment (live rows), OpenCode server log lines for both plugin loads; issue #503 (V1) and #394.
