---
name: Feature request
about: Suggest an idea or improvement for cc-master
title: "[feat] "
labels: enhancement
assignees: ''
---

## Problem / motivation

What are you trying to do that cc-master makes hard or impossible today? Describe
the situation, not just the solution you have in mind.

## Proposed solution

What you'd like to see. Be concrete where you can.

## Alternatives considered

Other approaches you thought about, and why they fall short.

## Fit with cc-master's design

cc-master keeps a deliberately small surface. Please check the boxes that apply
so we can reason about fit (see [CONTRIBUTING.md](../../CONTRIBUTING.md)):

- [ ] Stays **ship-anywhere** (works on Anthropic API, Bedrock, Vertex, Foundry —
      no agent-teams / scheduled-routines dependency)
- [ ] Hooks (if touched) stay **pure bash**, no `jq` / `node`
- [ ] Keeps the board's **narrow waist** stable
- [ ] Respects the **Skill A / Skill B** split (orchestration vs script authoring)
- [ ] Keeps the conductor from doing unit work by hand

## Additional context

Links, prior art, related issues, or a sketch of how it might work.
