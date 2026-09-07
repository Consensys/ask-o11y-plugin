// Package skills implements the Agent Skills format (agentskills.io) for
// ask-o11y: SKILL.md files with YAML frontmatter that modularize the
// assistant's domain instructions. A skill activates explicitly (chat skill
// picker, ?skill= deep link, legacy request type), automatically (message
// trigger regex), or on demand (the agent's internal load_skill tool reading
// the catalog injected into the system prompt).
package skills

import (
	"fmt"
	"regexp"
	"strings"
	"text/template"
)

const (
	// VisibilityPublic skills appear in the chat skill picker and the
	// load_skill catalog. VisibilityHidden skills are reserved for internal
	// pipelines and are never offered to users or the model.
	VisibilityPublic = "public"
	VisibilityHidden = "hidden"

	// SourceBundled skills ship inside the plugin binary. SourceCustom
	// skills are admin-authored in AppConfig and stored in plugin jsonData.
	SourceBundled = "bundled"
	SourceCustom  = "custom"
)

// Limits mirrored from the Agent Skills specification.
const (
	MaxNameLength           = 64
	MaxDescriptionLength    = 1024
	MaxCompatibilityLength = 500
)

// skillNamePattern enforces the spec naming rules: lowercase alphanumerics
// and hyphens, no leading/trailing hyphen, no consecutive hyphens.
var skillNamePattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// blockedTemplateActions matches the text/template actions that can invoke
// other templates or functions. Skill bodies are admin-editable content, so
// the guard PromptEditor enforces client-side is enforced at parse time too.
var blockedTemplateActions = regexp.MustCompile(`\{\{-?\s*(call|template|define|block)\b`)

// Skill is a parsed, validated SKILL.md.
type Skill struct {
	Name          string
	Description   string
	Body          string
	License       string
	Compatibility string
	Metadata      map[string]string

	// Behavior metadata resolved from the metadata map.
	Model         string // "base" | "large" | "" (no preference)
	MaxIterations int    // 0 = no preference
	Triggers      string // case-insensitive regex; auto-activates on match
	UserPrompt    string // Go template wrapping the first user message for explicit activation
	Visibility    string // public (default) | hidden
	Version       string

	// Source records where the content came from. Customized marks a bundled
	// skill whose SKILL.md was overridden by an admin entry.
	Source     string
	Customized bool

	// References holds optional extra files (progressive-disclosure level 3)
	// keyed by path relative to the skill root, loadable via load_skill.
	References map[string]string

	// Raw is the original SKILL.md content, for the AppConfig editor.
	Raw string

	triggerRe      *regexp.Regexp
	bodyTemplate   *template.Template
	userPromptTmpl *template.Template
}

// frontmatter mirrors the SKILL.md YAML frontmatter. Metadata is a flat
// string map: nested values are rejected so ask-o11y-specific keys stay
// simple and serializable into jsonData.
type frontmatter struct {
	Name          string            `yaml:"name"`
	Description   string            `yaml:"description"`
	License       string            `yaml:"license"`
	Compatibility string            `yaml:"compatibility"`
	AllowedTools  string            `yaml:"allowed-tools"`
	Metadata      map[string]string `yaml:"metadata"`
}

// Parse parses and validates a SKILL.md content string.
func Parse(content string) (*Skill, error) {
	fmRaw, body, err := splitFrontmatter(content)
	if err != nil {
		return nil, err
	}

	var fm frontmatter
	if err := yamlUnmarshal([]byte(fmRaw), &fm); err != nil {
		return nil, fmt.Errorf("invalid frontmatter YAML: %w", err)
	}

	name := strings.TrimSpace(fm.Name)
	if name == "" {
		return nil, fmt.Errorf("frontmatter field 'name' is required")
	}
	if len(name) > MaxNameLength || !skillNamePattern.MatchString(name) {
		return nil, fmt.Errorf("invalid skill name %q: must be 1-%d characters of lowercase letters, numbers, and single hyphens", name, MaxNameLength)
	}
	description := strings.TrimSpace(fm.Description)
	if description == "" {
		return nil, fmt.Errorf("frontmatter field 'description' is required")
	}
	if len(description) > MaxDescriptionLength {
		return nil, fmt.Errorf("description exceeds %d characters", MaxDescriptionLength)
	}
	if len(fm.Compatibility) > MaxCompatibilityLength {
		return nil, fmt.Errorf("compatibility exceeds %d characters", MaxCompatibilityLength)
	}

	s := &Skill{
		Name:          name,
		Description:   description,
		Body:          body,
		License:       fm.License,
		Compatibility: fm.Compatibility,
		Metadata:      fm.Metadata,
		Visibility:    VisibilityPublic,
		Raw:           content,
	}
	if s.Metadata == nil {
		s.Metadata = map[string]string{}
	}
	s.Model = strings.TrimSpace(s.Metadata["model"])
	s.Version = strings.TrimSpace(s.Metadata["version"])
	s.Triggers = strings.TrimSpace(s.Metadata["triggers"])
	s.UserPrompt = strings.TrimSpace(s.Metadata["user-prompt"])
	if v := strings.TrimSpace(s.Metadata["visibility"]); v != "" {
		s.Visibility = v
	}
	if s.Visibility != VisibilityPublic && s.Visibility != VisibilityHidden {
		return nil, fmt.Errorf("invalid visibility %q: must be %q or %q", s.Visibility, VisibilityPublic, VisibilityHidden)
	}
	if s.Model != "" && s.Model != "base" && s.Model != "large" {
		return nil, fmt.Errorf("invalid model %q: must be \"base\" or \"large\"", s.Model)
	}
	if n := strings.TrimSpace(s.Metadata["max-iterations"]); n != "" {
		var iterations int
		if _, err := fmt.Sscanf(n, "%d", &iterations); err != nil || iterations < 1 || iterations > 200 {
			return nil, fmt.Errorf("invalid max-iterations %q: must be an integer between 1 and 200", n)
		} else {
			s.MaxIterations = iterations
		}
	}

	if s.Triggers != "" {
		re, err := regexp.Compile(`(?i)` + s.Triggers)
		if err != nil {
			return nil, fmt.Errorf("invalid triggers regex: %w", err)
		}
		s.triggerRe = re
	}

	for name, text := range map[string]string{"body": s.Body, "user-prompt": s.UserPrompt} {
		if blockedTemplateActions.MatchString(text) {
			return nil, fmt.Errorf("forbidden template action in %s (call/template/define/block are not allowed)", name)
		}
	}
	if s.Body != "" {
		t, err := template.New(s.Name + ":body").Parse(s.Body)
		if err != nil {
			return nil, fmt.Errorf("body is not a valid template: %w", err)
		}
		s.bodyTemplate = t
	}
	if s.UserPrompt != "" {
		t, err := template.New(s.Name + ":user-prompt").Parse(s.UserPrompt)
		if err != nil {
			return nil, fmt.Errorf("user-prompt is not a valid template: %w", err)
		}
		s.userPromptTmpl = t
	}

	return s, nil
}

// splitFrontmatter separates the leading YAML frontmatter block from the
// Markdown body. The document must open with a `---` line and close the
// frontmatter with a matching `---` line.
func splitFrontmatter(content string) (frontmatter, body string, err error) {
	trimmed := strings.TrimLeft(content, "\ufeff \t\r\n")
	lines := strings.Split(trimmed, "\n")
	if strings.TrimSpace(lines[0]) != "---" {
		return "", "", fmt.Errorf("SKILL.md must start with a '---' frontmatter delimiter")
	}
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(strings.TrimSuffix(lines[i], "\r")) == "---" {
			return strings.Join(lines[1:i], "\n"), strings.Join(lines[i+1:], "\n"), nil
		}
	}
	return "", "", fmt.Errorf("SKILL.md frontmatter is not closed by a '---' delimiter")
}

// RenderBody executes the body template with data (for example a
// PromptContext). A skill without a body template renders as empty string.
func (s *Skill) RenderBody(data interface{}) (string, error) {
	if s.bodyTemplate == nil {
		return "", nil
	}
	return renderTemplate(s.bodyTemplate, s.Name+" body", data)
}

// RenderUserPrompt executes the user-prompt template; empty result means the
// skill does not wrap the user message.
func (s *Skill) RenderUserPrompt(data interface{}) (string, error) {
	if s.userPromptTmpl == nil {
		return "", nil
	}
	return renderTemplate(s.userPromptTmpl, s.Name+" user-prompt", data)
}

// MatchesTrigger reports whether the message matches the skill's trigger
// regex (case-insensitive). Skills without triggers never auto-activate.
func (s *Skill) MatchesTrigger(message string) bool {
	return s.triggerRe != nil && s.triggerRe.MatchString(message)
}

func renderTemplate(t *template.Template, name string, data interface{}) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			result = ""
			err = fmt.Errorf("template panic in %s: %v", name, r)
		}
	}()
	var buf strings.Builder
	if execErr := t.Execute(&buf, data); execErr != nil {
		return "", fmt.Errorf("failed to render %s: %w", name, execErr)
	}
	return buf.String(), nil
}

func templateParse(name, text string) (*template.Template, error) {
	return template.New(name).Parse(text)
}
