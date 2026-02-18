package plugin

import (
	"bytes"
	"fmt"
	"log"
	"text/template"
)

type ToolInfo struct {
	Name         string
	Description  string
	Instructions string
	DocsURL      string
	Error        string
}

type PromptContext struct {
	AlertName string
	Target    string

	AvailableTools []ToolInfo
	DisabledTools  []ToolInfo
	FailedTools    []ToolInfo

	OrgName  string
	UserRole string
}

type PromptRegistry struct {
	systemTemplate       *template.Template
	investigationTemplate *template.Template
	performanceTemplate   *template.Template
	toolInstructionsTemplate *template.Template
}

func NewPromptRegistry(settings PluginSettings) (*PromptRegistry, error) {
	registry := &PromptRegistry{}

	registry.systemTemplate = parseTemplateWithFallback("system", settings.DefaultSystemPrompt, DefaultSystemPrompt)
	registry.investigationTemplate = parseTemplateWithFallback("investigation", settings.InvestigationPrompt, DefaultInvestigationPrompt)
	registry.performanceTemplate = parseTemplateWithFallback("performance", settings.PerformancePrompt, DefaultPerformancePrompt)

	var err error
	registry.toolInstructionsTemplate, err = template.New("tool_instructions").Parse(ToolInstructionsFragment)
	if err != nil {
		return nil, fmt.Errorf("failed to parse tool instructions template: %w", err)
	}

	return registry, nil
}

func parseTemplateWithFallback(name, custom, fallback string) *template.Template {
	text := custom
	if text == "" {
		text = fallback
	}
	t, err := template.New(name).Parse(text)
	if err != nil {
		log.Printf("[WARN] Invalid %s template, falling back to default: %v", name, err)
		t = template.Must(template.New(name).Parse(fallback))
	}
	return t
}

func (r *PromptRegistry) BuildSystemPrompt(ctx PromptContext) (string, error) {
	system, err := renderTemplate(r.systemTemplate, "system prompt", ctx)
	if err != nil {
		return "", err
	}
	tools, err := renderTemplate(r.toolInstructionsTemplate, "tool instructions", ctx)
	if err != nil {
		return "", err
	}
	return system + tools, nil
}

func (r *PromptRegistry) BuildUserPrompt(convType, message string, ctx PromptContext) (string, error) {
	switch convType {
	case "investigation":
		ctx.AlertName = extractAlertNameForTitle(message)
		if ctx.AlertName == "" {
			return "", fmt.Errorf("investigation type requires alertName")
		}
		return renderTemplate(r.investigationTemplate, "investigation prompt", ctx)

	case "performance":
		ctx.Target = extractTargetForTitle(message)
		if ctx.Target == "" {
			ctx.Target = message
		}
		return renderTemplate(r.performanceTemplate, "performance prompt", ctx)

	case "chat", "":
		return message, nil

	default:
		return "", fmt.Errorf("unknown conversation type: %s", convType)
	}
}

func renderTemplate(t *template.Template, name string, data interface{}) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			result = ""
			err = fmt.Errorf("template panic in %s: %v", name, r)
		}
	}()
	var buf bytes.Buffer
	if execErr := t.Execute(&buf, data); execErr != nil {
		return "", fmt.Errorf("failed to render %s: %w", name, execErr)
	}
	return buf.String(), nil
}

func BuildToolContext(orgName, userRole string) PromptContext {
	return PromptContext{
		OrgName:        orgName,
		UserRole:       userRole,
		AvailableTools: []ToolInfo{},
		DisabledTools:  []ToolInfo{},
		FailedTools:    []ToolInfo{},
	}
}
