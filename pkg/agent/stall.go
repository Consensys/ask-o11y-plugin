package agent

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
)

// Repetition and stall guards target the two procedural reasoning failures
// that most strongly predict an incorrect RCA answer (arXiv 2601.22208):
// RF-12 (repetition / stalled progress — the model re-issues effectively
// identical calls or keeps querying without learning anything) and RF-09
// (failure to update belief when evidence does not arrive). The guard is
// deliberately conservative: it never blocks a first attempt, reuses cached
// results only for byte-identical repeats of calls that already succeeded,
// and nudges at most once per condition before forcing a final answer.
const (
	// nearDupNudgeThreshold is how many repetition events (exact or
	// near-duplicate calls) accumulate before the model is told to change
	// hypothesis.
	nearDupNudgeThreshold = 3

	// stalledIterationThreshold is how many consecutive iterations with no
	// new successful evidence trigger the stalled-progress nudge. A second
	// stalled episode after that nudge forces a final answer.
	stalledIterationThreshold = 4

	// nearDupSimilarity is the character-trigram Jaccard similarity above
	// which two calls to the same tool count as near-duplicates. Calibrated
	// against realistic re-queries: a widened or shifted time window scores
	// ~0.77-0.87 (a repetition), while a different metric (~0.17) or a
	// different label value (~0.6, a legitimate next step) stays below.
	nearDupSimilarity = 0.7
)

// Stall event kinds, surfaced on the SSE stream and in the run trace.
const (
	StallKindRepetition  = "repetition"
	StallKindStalled     = "stalled"
	StallKindForcedFinal = "forced_final"
)

const (
	nearDupNudge = "[SYSTEM: Your last several tool calls repeat earlier queries with only cosmetic differences. Re-querying will not produce new information. Switch hypothesis — state what evidence would distinguish the remaining candidates — or conclude with the evidence you already have.]"

	stallNudge = "[SYSTEM: Several consecutive iterations produced no new evidence. Stop querying for now: state your current hypotheses, what evidence would falsify each, and either run one decisive check or conclude — including open gaps if the evidence is insufficient.]"

	forcedFinalNudge = "[SYSTEM: Progress has stalled repeatedly. Produce a final answer NOW based ONLY on the tool results you already have. Do not fabricate. Record unresolved questions as gaps.]"

	duplicateCallNote = "[SYSTEM: identical call already executed at iteration %d — reuse that result or change approach]"
)

// stallCacheHit remembers an earlier successful result for an exact tool
// signature, so an identical repeat can be answered without a round trip.
type stallCacheHit struct {
	content   string
	iteration int
}

// stallDetector tracks per-run tool-call history for the repetition and
// stall guards. All methods are called from the loop goroutine only (setup,
// finish, and post-batch accounting are sequential) and need no lock.
type stallDetector struct {
	toolSigs map[string][]string      // tool -> prior canonical signatures
	cache    map[string]stallCacheHit // exact signature -> earlier success

	nearDupCount     int
	nearDupNudged    bool
	noProgressStreak int
	stallNudged      bool
	forceFinalNudged bool
}

func newStallDetector() *stallDetector {
	return &stallDetector{
		toolSigs: make(map[string][]string),
		cache:    make(map[string]stallCacheHit),
	}
}

// checkExact reports whether this exact signature already succeeded earlier
// in the run.
func (d *stallDetector) checkExact(sig string) (stallCacheHit, bool) {
	hit, ok := d.cache[sig]
	return hit, ok
}

// observe records a call and reports whether it near-duplicates a prior call
// to the same tool (high token similarity, not an exact match). Exact
// matches are not counted here — they are handled by checkExact.
func (d *stallDetector) observe(tool, sig string) bool {
	for _, prev := range d.toolSigs[tool] {
		if prev == sig {
			continue
		}
		if tokenSimilarity(prev, sig) >= nearDupSimilarity {
			d.nearDupCount++
			d.toolSigs[tool] = append(d.toolSigs[tool], sig)
			return true
		}
	}
	d.toolSigs[tool] = append(d.toolSigs[tool], sig)
	return false
}

// noteRepetition counts an exact duplicate toward the repetition nudge.
func (d *stallDetector) noteRepetition() {
	d.nearDupCount++
}

// rememberSuccess caches a successful result so identical repeats can be
// replayed. The first success wins; later differing results for the same
// signature are kept out of the cache to keep replay deterministic.
func (d *stallDetector) rememberSuccess(sig string, iteration int, content string) {
	if _, exists := d.cache[sig]; !exists {
		d.cache[sig] = stallCacheHit{content: content, iteration: iteration}
	}
}

// recordBatchProgress updates the consecutive no-progress streak. An
// iteration made progress iff at least one freshly executed call returned a
// non-error, non-empty result; replayed cache hits do not count.
func (d *stallDetector) recordBatchProgress(madeProgress bool) {
	if madeProgress {
		d.noProgressStreak = 0
		return
	}
	d.noProgressStreak++
}

// pendingNudge returns the next one-shot system message to inject, if any.
// The forced flag additionally asks the loop to shorten the remaining
// iteration budget so the run ends promptly.
func (d *stallDetector) pendingNudge() (kind, msg string, forced bool) {
	if d.nearDupCount >= nearDupNudgeThreshold && !d.nearDupNudged {
		d.nearDupNudged = true
		return StallKindRepetition, nearDupNudge, false
	}
	if d.noProgressStreak >= stalledIterationThreshold {
		if !d.stallNudged {
			d.stallNudged = true
			return StallKindStalled, stallNudge, false
		}
		if !d.forceFinalNudged {
			d.forceFinalNudged = true
			return StallKindForcedFinal, forcedFinalNudge, true
		}
	}
	return "", "", false
}

// duplicateCallContent renders the replayed result the model sees for an
// exact duplicate: the earlier content plus a directive that it is a repeat.
func duplicateCallContent(hit stallCacheHit) string {
	return fmt.Sprintf("%s\n\n%s", hit.content, fmt.Sprintf(duplicateCallNote, hit.iteration))
}

// canonicalToolSignature builds the dedup key for a tool call: the tool name
// plus its arguments with JSON object keys canonicalized (Go marshals maps
// with sorted keys), so formatting and key order differences do not hide an
// identical repeat. Non-JSON arguments fall back to the raw string.
func canonicalToolSignature(tool, args string) string {
	var parsed interface{}
	if err := json.Unmarshal([]byte(args), &parsed); err == nil {
		if canon, err := json.Marshal(parsed); err == nil {
			args = string(canon)
		}
	}
	return tool + " " + args
}

// tokenSimilarity returns the Jaccard similarity of the character-trigram
// sets of two canonical signatures (see signatureTokens).
func tokenSimilarity(a, b string) float64 {
	ta := signatureTokens(a)
	tb := signatureTokens(b)
	if len(ta) == 0 && len(tb) == 0 {
		return 1
	}
	intersect := 0
	for tok := range ta {
		if _, ok := tb[tok]; ok {
			intersect++
		}
	}
	union := len(ta) + len(tb) - intersect
	if union == 0 {
		return 1
	}
	return float64(intersect) / float64(union)
}

// signatureTokens reduces a canonical signature to a set of character
// trigrams of its lowercased alphanumeric content. Trigrams make the
// similarity smooth: the same query with a tweaked time window stays above
// the threshold, while a different metric or query does not.
func signatureTokens(sig string) map[string]struct{} {
	compact := strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, sig)
	tokens := map[string]struct{}{}
	runes := []rune(compact)
	for i := 0; i+3 <= len(runes); i++ {
		tokens[string(runes[i:i+3])] = struct{}{}
	}
	return tokens
}
