package mcp

import "strings"

type ToolRisk struct {
	ToolName         string `json:"toolName"`
	ServerID         string `json:"serverId,omitempty"`
	ReadOnly         bool   `json:"readOnly"`
	Destructive      bool   `json:"destructive"`
	OpenWorld        bool   `json:"openWorld"`
	Trusted          bool   `json:"trusted"`
	RequiresApproval bool   `json:"requiresApproval"`
	Reason           string `json:"reason"`
}

func ClassifyToolRisk(tool Tool, servers []ServerConfig) ToolRisk {
	serverID, unprefixedName := splitToolName(tool.Name)
	risk := ToolRisk{
		ToolName: tool.Name,
		ServerID: serverID,
		Trusted:  false,
	}

	var override *ToolRiskOverride
	if server, ok := findServerConfig(serverID, servers); ok {
		risk.Trusted = server.Trusted
		if o, found := findRiskOverride(tool.Name, unprefixedName, server.RiskOverrides); found {
			copy := o
			override = &copy
		}
	}

	if tool.Annotations != nil {
		risk.ReadOnly = boolValue(tool.Annotations.ReadOnlyHint)
		risk.Destructive = boolValue(tool.Annotations.DestructiveHint)
		risk.OpenWorld = boolValue(tool.Annotations.OpenWorldHint)
	}

	heuristicDestructive, heuristicOpenWorld, heuristicWrite := classifyNameHeuristics(unprefixedName)
	if heuristicDestructive {
		risk.Destructive = true
	}
	if heuristicOpenWorld {
		risk.OpenWorld = true
	}

	if override != nil {
		if override.ReadOnly != nil {
			risk.ReadOnly = *override.ReadOnly
		}
		if override.Destructive != nil {
			risk.Destructive = *override.Destructive
		}
		if override.OpenWorld != nil {
			risk.OpenWorld = *override.OpenWorld
		}
	}

	risk.RequiresApproval = risk.Destructive || risk.OpenWorld || (!risk.ReadOnly && heuristicWrite)
	if override != nil && override.RequiresApproval != nil {
		risk.RequiresApproval = *override.RequiresApproval
	}

	risk.Reason = riskReason(risk, heuristicWrite, override)
	return risk
}

func splitToolName(toolName string) (serverID string, unprefixed string) {
	serverID, rest, ok := strings.Cut(toolName, "_")
	if !ok {
		return "", toolName
	}
	return serverID, rest
}

func findServerConfig(serverID string, servers []ServerConfig) (ServerConfig, bool) {
	for _, server := range servers {
		if server.ID == serverID {
			return server, true
		}
	}
	return ServerConfig{}, false
}

func findRiskOverride(fullName, unprefixedName string, overrides map[string]ToolRiskOverride) (ToolRiskOverride, bool) {
	if len(overrides) == 0 {
		return ToolRiskOverride{}, false
	}
	if override, ok := overrides[fullName]; ok {
		return override, true
	}
	if override, ok := overrides[unprefixedName]; ok {
		return override, true
	}
	return ToolRiskOverride{}, false
}

func boolValue(v *bool) bool {
	return v != nil && *v
}

func classifyNameHeuristics(name string) (destructive bool, openWorld bool, write bool) {
	normalized := strings.ToLower(strings.ReplaceAll(name, "-", "_"))
	parts := strings.FieldsFunc(normalized, func(r rune) bool {
		return r == '_' || r == '.' || r == '/' || r == ':' || r == ' '
	})
	for _, part := range parts {
		switch part {
		case "delete", "remove", "clear", "drop", "truncate", "destroy", "purge":
			destructive = true
			write = true
		case "send", "email", "slack", "webhook", "publish", "notify", "postmessage":
			openWorld = true
			write = true
		case "create", "update", "write", "set", "patch", "put", "post", "deploy", "restart", "stop", "start", "silence", "mute", "unmute", "pause", "resume", "import", "add", "apply", "provision", "grant", "revoke":
			write = true
		}
	}
	return destructive, openWorld, write
}

func riskReason(risk ToolRisk, heuristicWrite bool, override *ToolRiskOverride) string {
	if override != nil && override.Reason != "" {
		return override.Reason
	}
	if !risk.RequiresApproval {
		if risk.ReadOnly {
			return "Tool is classified as read-only."
		}
		return "Tool does not match write, destructive, or external-communication risk signals."
	}
	switch {
	case risk.Destructive:
		return "Tool is destructive or can delete/clear data."
	case risk.OpenWorld:
		return "Tool can communicate outside Grafana or the configured observability backend."
	case heuristicWrite:
		return "Tool name indicates a write or state-changing operation."
	default:
		return "Tool requires approval by policy."
	}
}
