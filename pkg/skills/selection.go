package skills

import (
	"fmt"
	"sort"
)

// TypeSkillNames maps the legacy request types (kept for backwards
// compatibility with the alert-notification deep link and the POST body
// contract) to their skill equivalents.
var TypeSkillNames = map[string]string{
	"investigation": "investigating-alerts",
	"performance":   "analyzing-performance",
}

// Activation is the resolved skill set for one agent run. Skills lists every
// active skill (explicit first, then trigger-activated); Explicit is the
// subset chosen by the user (picker or ?skill= URL param). Only the legacy
// type mapping sets UserPromptSkill — picker and trigger activation keep the
// user's message verbatim, while the deep-link contract (?type=investigation
// with alertName) continues to wrap the message with the skill's template.
type Activation struct {
	Skills         []*Skill
	Explicit       []*Skill
	UserPromptSkill *Skill
}

// Resolve computes the activation for a run:
//
//   - requested skills (POST body "skills") must exist, be enabled and
//     public — anything else is a caller error;
//   - the legacy type mapping is best-effort: if the mapped skill was
//     disabled or overridden away, the run proceeds without it (fallback
//     heuristics such as resolveMaxIterations still apply) so the
//     ?type=investigation deep link never breaks;
//   - trigger regexes auto-activate matching enabled public skills.
func Resolve(reg *Registry, message string, requested []string, legacyType string) (*Activation, error) {
	act := &Activation{}
	seen := map[string]bool{}

	addExplicit := func(s *Skill) {
		if seen[s.Name] {
			return
		}
		seen[s.Name] = true
		act.Skills = append(act.Skills, s)
		act.Explicit = append(act.Explicit, s)
	}

	for _, name := range requested {
		s, ok := reg.Get(name)
		if !ok || s.Visibility != VisibilityPublic {
			return nil, fmt.Errorf("unknown skill: %s", name)
		}
		addExplicit(s)
	}

	if mapped, ok := TypeSkillNames[legacyType]; ok {
		if s, found := reg.Get(mapped); found && s.Visibility == VisibilityPublic {
			addExplicit(s)
			act.UserPromptSkill = s
		}
	}

	for _, s := range reg.Catalog() {
		if seen[s.Name] {
			continue
		}
		if s.MatchesTrigger(message) {
			seen[s.Name] = true
			act.Skills = append(act.Skills, s)
		}
	}

	return act, nil
}

// HasActive reports whether the named skill is part of the activation.
func HasActive(act *Activation, name string) bool {
	if act == nil {
		return false
	}
	for _, s := range act.Skills {
		if s.Name == name {
			return true
		}
	}
	return false
}

// ModelPreference returns the first model preference set by an active skill.
func ModelPreference(act *Activation) string {
	if act == nil {
		return ""
	}
	for _, s := range act.Skills {
		if s.Model != "" {
			return s.Model
		}
	}
	return ""
}

// IterationBudget returns the highest iteration budget requested by an
// active skill, or 0 when no skill sets one.
func IterationBudget(act *Activation) int {
	if act == nil {
		return 0
	}
	max := 0
	for _, s := range act.Skills {
		if s.MaxIterations > max {
			max = s.MaxIterations
		}
	}
	return max
}

// ActiveNames returns the sorted active skill names, for logging and SSE
// metadata.
func ActiveNames(act *Activation) []string {
	if act == nil || len(act.Skills) == 0 {
		return nil
	}
	names := make([]string, 0, len(act.Skills))
	for _, s := range act.Skills {
		names = append(names, s.Name)
	}
	sort.Strings(names)
	return names
}
