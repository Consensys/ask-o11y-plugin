import { getSecureHeaderKey, parseSecureHeaderKey } from '../plugin';

describe('plugin types', () => {
  describe('getSecureHeaderKey', () => {
    it('should generate correct key format', () => {
      expect(getSecureHeaderKey('server-1', 'Authorization')).toBe('mcp_server-1_header_Authorization');
    });

    it('should handle server IDs with special characters', () => {
      expect(getSecureHeaderKey('my-mcp-server', 'X-API-Key')).toBe('mcp_my-mcp-server_header_X-API-Key');
    });

    it('should handle header keys with hyphens', () => {
      expect(getSecureHeaderKey('server', 'Content-Type')).toBe('mcp_server_header_Content-Type');
    });

    it('should handle simple server ID and header key', () => {
      expect(getSecureHeaderKey('test', 'key')).toBe('mcp_test_header_key');
    });
  });

  describe('parseSecureHeaderKey', () => {
    it('should parse valid secure header key', () => {
      const result = parseSecureHeaderKey('mcp_server-1_header_Authorization');
      expect(result).toEqual({ serverId: 'server-1', headerKey: 'Authorization' });
    });

    it('should parse key with hyphenated header name', () => {
      const result = parseSecureHeaderKey('mcp_my-server_header_X-API-Key');
      expect(result).toEqual({ serverId: 'my-server', headerKey: 'X-API-Key' });
    });

    it('should return null for invalid key format', () => {
      expect(parseSecureHeaderKey('invalid_key')).toBeNull();
    });

    it('should return null for key without mcp prefix', () => {
      expect(parseSecureHeaderKey('server_header_Authorization')).toBeNull();
    });

    it('should return null for key without header segment', () => {
      expect(parseSecureHeaderKey('mcp_server_Authorization')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseSecureHeaderKey('')).toBeNull();
    });

    it('should handle server ID containing underscores (greedy match)', () => {
      const result = parseSecureHeaderKey('mcp_server_name_header_key');
      expect(result).toEqual({ serverId: 'server_name', headerKey: 'key' });
    });

    it('should roundtrip correctly', () => {
      const serverId = 'my-server';
      const headerKey = 'Authorization';
      const secureKey = getSecureHeaderKey(serverId, headerKey);
      const parsed = parseSecureHeaderKey(secureKey);
      expect(parsed).toEqual({ serverId, headerKey });
    });
  });
});
