# AGENTS.md

**DEPRECATED** — See [CLAUDE.md](./CLAUDE.md) for the authoritative project documentation.

This file is kept for backwards compatibility but is no longer maintained.

## Standards review before every PR

The Grafana plugin catalog runs an LLM review of `src/` and `pkg/` against a fixed question list. That review found five defects at 0.3.27 that every gate of the time passed. The analyzer skips silently when no LLM key is set, so CI cannot be trusted to run it.

Run the review here instead, before the PR opens:

```bash
npm run review:diff            # diff against origin/main + the question list
npm run review:diff -- <ref>   # diff against <ref>
npm run review:sync            # report drift in the upstream question list
```

Answer every question with a `file:line` citation. A "yes" on a blocking question is fixed before the PR opens, not after. Put the answer table in the PR body.

The question list is `.github/llm-review-questions.json`. It copies the upstream list from the plugin-validator `llmreview` pass and adds this project's own rules. Do not edit the copied questions by hand; run `npm run review:sync -- --write`.

Deterministic checks for the same class of defect run in CI: `npm run lint:standards` and `golangci-lint run ./pkg/...` (config in `.golangci.yml`). See `CLAUDE.md` → Standards Gates, and the constitution, Principle VIII.
