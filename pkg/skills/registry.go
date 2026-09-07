package skills

import (
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

//go:embed bundled
var bundledFS embed.FS

// Entry is one admin-managed skill record stored in plugin jsonData. For a
// bundled skill name, Content overrides the shipped SKILL.md; for a new name
// it defines a custom skill. An entry with empty Content and Enabled=false
// simply disables the bundled skill. Enabled nil means enabled (the Go zero
// value keeps existing installs that predate this setting on).
type Entry struct {
	Content string `json:"content,omitempty"`
	Enabled *bool  `json:"enabled,omitempty"`
}

// Settings is the jsonData shape for the skills AppConfig tab.
type Settings struct {
	Entries map[string]Entry `json:"entries,omitempty"`
}

// Info is the JSON representation returned by GET /api/skills. Bodies are
// excluded by default so the endpoint is safe for all roles; Raw is only
// populated for Admin callers passing ?include=content (the AppConfig
// editor needs the SKILL.md source).
type Info struct {
	Name          string `json:"name"`
	Description   string `json:"description"`
	Source        string `json:"source"`
	Customized    bool   `json:"customized"`
	Enabled       bool   `json:"enabled"`
	Hidden        bool   `json:"hidden"`
	Model         string `json:"model,omitempty"`
	MaxIterations int    `json:"maxIterations,omitempty"`
	Triggers      string `json:"triggers,omitempty"`
	Version       string `json:"version,omitempty"`
	HasUserPrompt bool   `json:"hasUserPrompt"`
	Invalid       bool   `json:"invalid,omitempty"`
	InvalidReason string `json:"invalidReason,omitempty"`
	Raw           string `json:"raw,omitempty"`
}

// Registry holds the merged bundled + custom skills for one app instance.
// It is rebuilt whenever Grafana recreates the instance (AppConfig save),
// mirroring the PromptRegistry lifecycle.
type Registry struct {
	byName map[string]*Skill
	order  []string
	infos  []Info
	// settingsEntries and bundledRaw back RawFor: the AppConfig editor needs
	// the SKILL.md source for every listed skill, including invalid and
	// disabled entries that are not in byName.
	settingsEntries map[string]Entry
	bundledRaw      map[string]string
}

// NewRegistry merges the embedded bundled skills with the admin-managed
// entries. It never fails: invalid entries are skipped and surfaced through
// Infos so the AppConfig UI can show why a skill is not active.
func NewRegistry(settings Settings, logger log.Logger) *Registry {
	r := &Registry{
		byName:          map[string]*Skill{},
		settingsEntries: settings.Entries,
		bundledRaw:      map[string]string{},
	}

	bundled, bundledRefs := loadBundled(logger)
	for _, s := range bundled {
		s.Source = SourceBundled
		s.References = bundledRefs[s.Name]
		r.bundledRaw[s.Name] = s.Raw
		r.insert(s)
	}

	names := make([]string, 0, len(settings.Entries))
	for name := range settings.Entries {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		entry := settings.Entries[name]
		enabled := entry.Enabled == nil || *entry.Enabled

		if entry.Content == "" {
			if s, ok := r.byName[name]; ok && s.Source == SourceBundled && !enabled {
				r.disable(s)
			} else if !enabled {
				r.infos = append(r.infos, Info{
					Name:          name,
					Source:        SourceCustom,
					Enabled:       false,
					Invalid:       true,
					InvalidReason: "entry has no SKILL.md content",
				})
			}
			continue
		}

		s, err := Parse(entry.Content)
		if err != nil {
			r.infos = append(r.infos, Info{
				Name:          name,
				Source:        SourceCustom,
				Enabled:       enabled,
				Invalid:       true,
				InvalidReason: err.Error(),
			})
			logger.Warn("Invalid custom skill skipped", "skill", name, "error", err)
			continue
		}
		if s.Name != name {
			r.infos = append(r.infos, Info{
				Name:          name,
				Source:        SourceCustom,
				Enabled:       enabled,
				Invalid:       true,
				InvalidReason: fmt.Sprintf("entry key %q must match the frontmatter name %q", name, s.Name),
			})
			logger.Warn("Custom skill name mismatch skipped", "entry", name, "skill", s.Name)
			continue
		}

		if existing, ok := r.byName[s.Name]; ok && existing.Source == SourceBundled {
			// Admin override of a bundled skill: replace the SKILL.md
			// content, keep the bundled reference files loadable.
			s.Source = SourceBundled
			s.Customized = true
			s.References = existing.References
			r.remove(existing)
		} else {
			s.Source = SourceCustom
		}
		if enabled {
			r.insert(s)
		} else {
			r.infos = append(r.infos, infoFromSkill(s, false))
		}
	}

	return r
}

func (r *Registry) insert(s *Skill) {
	r.byName[s.Name] = s
	r.order = append(r.order, s.Name)
	r.infos = append(r.infos, infoFromSkill(s, true))
}

func (r *Registry) remove(s *Skill) {
	delete(r.byName, s.Name)
	for i := range r.order {
		if r.order[i] == s.Name {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}
	for i := range r.infos {
		if r.infos[i].Name == s.Name {
			r.infos = append(r.infos[:i], r.infos[i+1:]...)
			break
		}
	}
}

func (r *Registry) disable(s *Skill) {
	r.remove(s)
	r.infos = append(r.infos, infoFromSkill(s, false))
}

// RawFor returns the SKILL.md source for a listed skill name: the admin
// entry's content when one exists (custom, override, or even invalid), the
// shipped bundled content otherwise.
func (r *Registry) RawFor(name string) (string, bool) {
	if r.settingsEntries != nil {
		if entry, ok := r.settingsEntries[name]; ok && entry.Content != "" {
			return entry.Content, true
		}
	}
	raw, ok := r.bundledRaw[name]
	return raw, ok
}

// InfosWithContent returns the listing with the SKILL.md source attached for
// callers authorized to edit skills (Admin).
func (r *Registry) InfosWithContent() []Info {
	out := r.Infos()
	for i := range out {
		if raw, ok := r.RawFor(out[i].Name); ok {
			out[i].Raw = raw
		}
	}
	return out
}

// Get returns an enabled, valid skill by exact name.
func (r *Registry) Get(name string) (*Skill, bool) {
	s, ok := r.byName[name]
	return s, ok
}

// Catalog returns the enabled, public, valid skills in registration order,
// optionally excluding the given names (typically the already-active ones,
// whose bodies are already injected into the system prompt).
func (r *Registry) Catalog(exclude ...string) []*Skill {
	excluded := make(map[string]bool, len(exclude))
	for _, name := range exclude {
		excluded[name] = true
	}
	out := make([]*Skill, 0, len(r.order))
	for _, name := range r.order {
		if excluded[name] {
			continue
		}
		if s := r.byName[name]; s.Visibility == VisibilityPublic {
			out = append(out, s)
		}
	}
	return out
}

// Infos returns the metadata listing for GET /api/skills, including invalid
// and disabled entries so the AppConfig can surface their status.
func (r *Registry) Infos() []Info {
	out := make([]Info, len(r.infos))
	copy(out, r.infos)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// SetUserPromptOverride replaces a skill's user-prompt template. It is the
// backwards-compatibility hook for the legacy investigationPrompt /
// performancePrompt jsonData fields, which predate the skills system.
func (r *Registry) SetUserPromptOverride(name, userPrompt string) error {
	s, ok := r.byName[name]
	if !ok {
		return fmt.Errorf("skill %q is not active; cannot override its user prompt", name)
	}
	if userPrompt == "" {
		return nil
	}
	if blockedTemplateActions.MatchString(userPrompt) {
		return fmt.Errorf("forbidden template action in user-prompt override for %s", name)
	}
	t, err := templateParse(name+":user-prompt-override", userPrompt)
	if err != nil {
		return fmt.Errorf("invalid user-prompt override for %s: %w", name, err)
	}
	clone := *s
	clone.UserPrompt = userPrompt
	clone.userPromptTmpl = t
	r.byName[name] = &clone
	return nil
}

// Load returns the skill's main instructions rendered with data, or one of
// its reference files (raw, untemplated) when file is set. This backs the
// agent's internal load_skill tool.
func (r *Registry) Load(name, file string, data interface{}) (string, error) {
	s, ok := r.byName[name]
	if !ok || s.Visibility != VisibilityPublic {
		return "", fmt.Errorf("unknown skill: %s", name)
	}
	if file == "" {
		body, err := s.RenderBody(data)
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(body) == "" {
			return "", fmt.Errorf("skill %s has no instructions", name)
		}
		return body, nil
	}
	content, ok := s.References[file]
	if !ok {
		return "", fmt.Errorf("skill %s has no reference file %q", name, file)
	}
	return content, nil
}

func infoFromSkill(s *Skill, enabled bool) Info {
	return Info{
		Name:          s.Name,
		Description:   s.Description,
		Source:        s.Source,
		Customized:    s.Customized,
		Enabled:       enabled,
		Hidden:        s.Visibility == VisibilityHidden,
		Model:         s.Model,
		MaxIterations: s.MaxIterations,
		Triggers:      s.Triggers,
		Version:       s.Version,
		HasUserPrompt: s.UserPrompt != "",
	}
}

func loadBundled(logger log.Logger) ([]*Skill, map[string]map[string]string) {
	var skills []*Skill
	refs := map[string]map[string]string{}

	roots, err := fs.ReadDir(bundledFS, "bundled")
	if err != nil {
		logger.Error("Failed to read bundled skills", "error", err)
		return skills, refs
	}
	names := make([]string, 0, len(roots))
	for _, root := range roots {
		if root.IsDir() {
			names = append(names, root.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		content, err := fs.ReadFile(bundledFS, "bundled/"+name+"/SKILL.md")
		if err != nil {
			logger.Error("Bundled skill missing SKILL.md", "skill", name, "error", err)
			continue
		}
		s, err := Parse(string(content))
		if err != nil {
			logger.Error("Bundled skill failed to parse — this is a build-time bug, fix the SKILL.md", "skill", name, "error", err)
			continue
		}
		if s.Name != name {
			logger.Error("Bundled skill directory must match frontmatter name", "dir", name, "skill", s.Name)
			continue
		}
		skills = append(skills, s)

		refDir := "bundled/" + name + "/references"
		if entries, err := fs.ReadDir(bundledFS, refDir); err == nil {
			skillRefs := map[string]string{}
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				data, err := fs.ReadFile(bundledFS, refDir+"/"+entry.Name())
				if err != nil {
					logger.Error("Failed to read bundled skill reference", "skill", name, "file", entry.Name(), "error", err)
					continue
				}
				skillRefs["references/"+entry.Name()] = string(data)
			}
			refs[name] = skillRefs
		}
	}
	return skills, refs
}
