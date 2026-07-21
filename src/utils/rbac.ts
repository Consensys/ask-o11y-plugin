/**
 * RBAC utilities for filtering MCP tools by user role using tool annotations.
 *
 * Role hierarchy:
 * - Admin/Editor: Full access to all tools
 * - Viewer: Read-only access (tools with readOnlyHint annotation)
 */

export type UserRole = 'Admin' | 'Editor' | 'Viewer';

interface ToolWithAnnotations {
  name: string;
  annotations?: {
    readOnlyHint?: boolean;
  };
}

export function isReadOnlyTool(tool: ToolWithAnnotations): boolean {
  return tool.annotations?.readOnlyHint === true;
}

export function canAccessTool(role: UserRole | string, tool: ToolWithAnnotations): boolean {
  if (role === 'Admin' || role === 'Editor') {
    return true;
  }
  return isReadOnlyTool(tool);
}

export function filterToolsByRole<T extends ToolWithAnnotations>(tools: T[], role: UserRole | string): T[] {
  if (role === 'Admin' || role === 'Editor') {
    return tools;
  }
  return tools.filter((tool) => canAccessTool(role, tool));
}
