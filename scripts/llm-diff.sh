#!/usr/bin/env bash
# Print everything needed to run the Grafana standards review on this branch.
#
# The catalog runs the plugin-validator's `llmreview` pass, which asks a fixed
# question list about src/ and pkg/. It skips silently when no LLM key is set,
# which is why the 0.3.27 review findings reached Grafana instead of us. This
# script produces the prompt for the agent in the coding harness, so the review
# runs before the PR opens and needs no key.
#
#   npm run review:diff            diff against origin/main
#   npm run review:diff -- <ref>   diff against <ref>
#
# The agent answers every question with a file:line citation. A "yes" on a
# blocking question is fixed before the PR opens.
set -euo pipefail

BASE="${1:-origin/main}"
if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  BASE="main"
fi
MERGE_BASE="$(git merge-base "$BASE" HEAD)"

echo "# Standards review prompt"
echo
echo "Repository: $(basename "$(git rev-parse --show-toplevel)")"
echo "Branch: $(git rev-parse --abbrev-ref HEAD)"
echo "Base: $BASE ($MERGE_BASE)"
echo
echo "Answer every question below about the diff at the end of this prompt."
echo "Give a file:line citation for each answer. Answer 'no' only when the diff"
echo "does not touch the pattern the question names."
echo
echo "## Questions"
echo
node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(".github/llm-review-questions.json", "utf8"));
for (const entry of [...data.questions, ...data.projectQuestions]) {
  const kind = entry.blocking ? "blocking" : "optional";
  console.log(`- [ ] ${entry.id} (${kind}): ${entry.question}`);
  console.log(`      expected: ${entry.expectedAnswer}`);
}
'
echo
echo "## Commits"
echo '```'
git log --oneline "$MERGE_BASE..HEAD"
echo '```'
echo
echo "## Files changed"
echo '```'
git diff --stat "$MERGE_BASE..HEAD"
echo '```'
echo
echo "## Diff"
echo '```diff'
git diff --unified=3 "$MERGE_BASE..HEAD" -- 'src' 'pkg'
echo '```'
