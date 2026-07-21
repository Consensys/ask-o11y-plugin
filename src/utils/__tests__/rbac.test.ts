import { isReadOnlyTool, canAccessTool, filterToolsByRole } from '../rbac';

const readOnly = (name: string) => ({ name, annotations: { readOnlyHint: true } });
const writable = (name: string) => ({ name, annotations: { readOnlyHint: false } });
const unannotated = (name: string) => ({ name });

describe('RBAC Utilities', () => {
  describe('isReadOnlyTool', () => {
    it('should return true for tools annotated as read-only', () => {
      expect(isReadOnlyTool(readOnly('get_dashboard'))).toBe(true);
      expect(isReadOnlyTool(readOnly('list_datasources'))).toBe(true);
    });

    it('should return false for tools annotated as writable', () => {
      expect(isReadOnlyTool(writable('create_dashboard'))).toBe(false);
      expect(isReadOnlyTool(writable('delete_dashboard'))).toBe(false);
    });

    it('should return false for tools without annotations', () => {
      expect(isReadOnlyTool(unannotated('some_tool'))).toBe(false);
    });
  });

  describe('canAccessTool', () => {
    it('should allow Admin access to all tools', () => {
      expect(canAccessTool('Admin', readOnly('get_dashboard'))).toBe(true);
      expect(canAccessTool('Admin', writable('create_dashboard'))).toBe(true);
      expect(canAccessTool('Admin', unannotated('some_tool'))).toBe(true);
    });

    it('should allow Editor access to all tools', () => {
      expect(canAccessTool('Editor', readOnly('get_dashboard'))).toBe(true);
      expect(canAccessTool('Editor', writable('create_dashboard'))).toBe(true);
      expect(canAccessTool('Editor', unannotated('some_tool'))).toBe(true);
    });

    it('should allow Viewer access to read-only tools only', () => {
      expect(canAccessTool('Viewer', readOnly('get_dashboard'))).toBe(true);
      expect(canAccessTool('Viewer', readOnly('list_datasources'))).toBe(true);
    });

    it('should deny Viewer access to writable tools', () => {
      expect(canAccessTool('Viewer', writable('create_dashboard'))).toBe(false);
      expect(canAccessTool('Viewer', writable('delete_dashboard'))).toBe(false);
    });

    it('should deny Viewer access to unannotated tools', () => {
      expect(canAccessTool('Viewer', unannotated('some_tool'))).toBe(false);
    });

    it('should treat unknown roles like Viewer', () => {
      expect(canAccessTool('Unknown', readOnly('get_dashboard'))).toBe(true);
      expect(canAccessTool('Unknown', writable('create_dashboard'))).toBe(false);
    });
  });

  describe('filterToolsByRole', () => {
    const mockTools = [
      readOnly('get_dashboard'),
      writable('create_dashboard'),
      readOnly('list_datasources'),
      writable('update_datasource'),
      unannotated('external_tool'),
    ];

    it('should return all tools for Admin', () => {
      const filtered = filterToolsByRole(mockTools, 'Admin');
      expect(filtered).toHaveLength(5);
      expect(filtered).toEqual(mockTools);
    });

    it('should return all tools for Editor', () => {
      const filtered = filterToolsByRole(mockTools, 'Editor');
      expect(filtered).toHaveLength(5);
      expect(filtered).toEqual(mockTools);
    });

    it('should return only read-only tools for Viewer', () => {
      const filtered = filterToolsByRole(mockTools, 'Viewer');
      expect(filtered).toHaveLength(2);
      expect(filtered.map((t) => t.name)).toEqual(['get_dashboard', 'list_datasources']);
    });

    it('should handle empty tool list', () => {
      expect(filterToolsByRole([], 'Viewer')).toEqual([]);
      expect(filterToolsByRole([], 'Admin')).toEqual([]);
    });

    it('should preserve additional properties on tools', () => {
      const toolsWithMetadata = [
        { ...readOnly('get_dashboard'), description: 'Get dashboard', version: '1.0' },
        { ...writable('create_dashboard'), description: 'Create dashboard', version: '1.0' },
      ];

      const filtered = filterToolsByRole(toolsWithMetadata, 'Viewer');
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toEqual({
        name: 'get_dashboard',
        annotations: { readOnlyHint: true },
        description: 'Get dashboard',
        version: '1.0',
      });
    });

    it('should treat unknown roles like Viewer', () => {
      const filtered = filterToolsByRole(mockTools, 'UnknownRole');
      expect(filtered).toHaveLength(2);
    });
  });
});
