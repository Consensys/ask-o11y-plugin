import { ValidationService } from '../validation';

describe('ValidationService', () => {
  describe('validateChatInput', () => {
    it('should accept valid input', () => {
      expect(ValidationService.validateChatInput('Hello world')).toBe('Hello world');
    });

    it('should trim whitespace', () => {
      expect(ValidationService.validateChatInput('  Hello world  ')).toBe('Hello world');
    });

    it('should throw on empty string', () => {
      expect(() => ValidationService.validateChatInput('')).toThrow('Input must be a non-empty string');
    });

    it('should throw on whitespace-only input', () => {
      expect(() => ValidationService.validateChatInput('   ')).toThrow('Input cannot be empty');
    });

    it('should throw on null input', () => {
      expect(() => ValidationService.validateChatInput(null as any)).toThrow('Input must be a non-empty string');
    });

    it('should throw on undefined input', () => {
      expect(() => ValidationService.validateChatInput(undefined as any)).toThrow('Input must be a non-empty string');
    });

    it('should throw on input exceeding max length', () => {
      const longInput = 'a'.repeat(10001);
      expect(() => ValidationService.validateChatInput(longInput)).toThrow('Input exceeds maximum length');
    });

    it('should accept input at max length', () => {
      const maxInput = 'a'.repeat(10000);
      expect(ValidationService.validateChatInput(maxInput)).toBe(maxInput);
    });

    it('should remove control characters', () => {
      const input = 'Hello\x00World\x1F';
      const result = ValidationService.validateChatInput(input);
      expect(result).toBe('HelloWorld');
    });

    it('should accept queries with container= label selector', () => {
      expect(ValidationService.validateChatInput('Show me logs where container=nginx')).toBe(
        'Show me logs where container=nginx'
      );
    });

    it('should accept queries mentioning PromQL expressions', () => {
      expect(ValidationService.validateChatInput('What is a PromQL expression (rate vs irate)?')).toBe(
        'What is a PromQL expression (rate vs irate)?'
      );
    });

    it('should accept queries with connection= labels', () => {
      expect(ValidationService.validateChatInput('Find metrics where connection=active')).toBe(
        'Find metrics where connection=active'
      );
    });

    it('should accept queries discussing eval in alerting', () => {
      expect(ValidationService.validateChatInput('How does the eval (evaluation) interval work?')).toBe(
        'How does the eval (evaluation) interval work?'
      );
    });

    it('should accept queries with version= and region= selectors', () => {
      expect(ValidationService.validateChatInput('Show pods where version=v2 and region=us-east-1')).toBe(
        'Show pods where version=v2 and region=us-east-1'
      );
    });
  });

  describe('validateQuery', () => {
    it('should accept valid PromQL query', () => {
      const query = 'rate(http_requests_total[5m])';
      expect(ValidationService.validateQuery(query, 'promql')).toBe(query);
    });

    it('should accept valid LogQL query', () => {
      const query = '{job="varlogs"} |= "error"';
      expect(ValidationService.validateQuery(query, 'logql')).toBe(query);
    });

    it('should throw on empty query', () => {
      expect(() => ValidationService.validateQuery('', 'promql')).toThrow('Query must be a non-empty string');
    });

    it('should throw on whitespace-only query', () => {
      expect(() => ValidationService.validateQuery('   ', 'promql')).toThrow('Query cannot be empty');
    });

    it('should throw on query exceeding max length', () => {
      const longQuery = 'a'.repeat(5001);
      expect(() => ValidationService.validateQuery(longQuery, 'promql')).toThrow('Query exceeds maximum length');
    });

    it('should throw on dangerous DROP pattern', () => {
      expect(() => ValidationService.validateQuery('; drop table users', 'promql')).toThrow(
        'Query contains potentially dangerous operations'
      );
    });

    it('should throw on dangerous DELETE pattern', () => {
      expect(() => ValidationService.validateQuery('; delete from users', 'promql')).toThrow(
        'Query contains potentially dangerous operations'
      );
    });

    it('should throw on dangerous TRUNCATE pattern', () => {
      expect(() => ValidationService.validateQuery('; truncate table', 'promql')).toThrow(
        'Query contains potentially dangerous operations'
      );
    });

    it('should throw on unbalanced parentheses in PromQL', () => {
      expect(() => ValidationService.validateQuery('rate(http_requests[5m]', 'promql')).toThrow(
        'Unbalanced parentheses'
      );
    });

    it('should throw on unbalanced brackets in PromQL', () => {
      expect(() => ValidationService.validateQuery('rate(http_requests[5m)', 'promql')).toThrow('Unbalanced brackets');
    });

    it('should throw on unbalanced braces in PromQL', () => {
      expect(() => ValidationService.validateQuery('rate(http_requests{job="test")', 'promql')).toThrow(
        'Unbalanced braces'
      );
    });
  });

  describe('validateMCPServerURL', () => {
    it('should accept valid HTTPS URL', () => {
      const url = 'https://example.com/api';
      expect(ValidationService.validateMCPServerURL(url)).toBe(url);
    });

    it('should accept valid HTTP URL', () => {
      const url = 'http://localhost:8080/mcp';
      expect(ValidationService.validateMCPServerURL(url)).toBe(url);
    });

    it('should throw on empty URL', () => {
      expect(() => ValidationService.validateMCPServerURL('')).toThrow('URL must be a non-empty string');
    });

    it('should throw on null URL', () => {
      expect(() => ValidationService.validateMCPServerURL(null as any)).toThrow('URL must be a non-empty string');
    });

    it('should throw on whitespace-only URL', () => {
      expect(() => ValidationService.validateMCPServerURL('   ')).toThrow('URL cannot be empty');
    });

    it('should throw on invalid URL format', () => {
      expect(() => ValidationService.validateMCPServerURL('not-a-url')).toThrow('Invalid URL format');
    });

    it('should throw on file:// protocol', () => {
      expect(() => ValidationService.validateMCPServerURL('file:///etc/passwd')).toThrow('Invalid URL format');
    });

    it('should throw on ftp:// protocol', () => {
      expect(() => ValidationService.validateMCPServerURL('ftp://example.com')).toThrow('Invalid URL format');
    });

    it('should throw on URL exceeding max length', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2050);
      expect(() => ValidationService.validateMCPServerURL(longUrl)).toThrow('URL exceeds maximum length');
    });
  });

  describe('validateSessionData', () => {
    it('should accept valid session data', () => {
      const sessionData = {
        id: 'session-1',
        title: 'Test Session',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      expect(ValidationService.validateSessionData(sessionData)).toEqual(sessionData);
    });

    it('should throw on null session data', () => {
      expect(() => ValidationService.validateSessionData(null)).toThrow('Session data must be an object');
    });

    it('should throw on non-object session data', () => {
      expect(() => ValidationService.validateSessionData('string')).toThrow('Session data must be an object');
    });

    it('should throw on missing session ID', () => {
      const sessionData = { title: 'Test', messages: [] };
      expect(() => ValidationService.validateSessionData(sessionData)).toThrow('Session must have a valid ID');
    });

    it('should throw on missing session title', () => {
      const sessionData = { id: 'session-1', messages: [] };
      expect(() => ValidationService.validateSessionData(sessionData)).toThrow('Session must have a valid title');
    });

    it('should throw on missing messages array', () => {
      const sessionData = { id: 'session-1', title: 'Test' };
      expect(() => ValidationService.validateSessionData(sessionData)).toThrow('Session must have a messages array');
    });

    it('should throw on invalid message role', () => {
      const sessionData = {
        id: 'session-1',
        title: 'Test',
        messages: [{ role: 'invalid', content: 'Hello' }],
      };
      expect(() => ValidationService.validateSessionData(sessionData)).toThrow('Invalid message role');
    });

    it('should throw on non-string message content', () => {
      const sessionData = {
        id: 'session-1',
        title: 'Test',
        messages: [{ role: 'user', content: 123 }],
      };
      expect(() => ValidationService.validateSessionData(sessionData)).toThrow('Message content must be a string');
    });

    it('should truncate long titles', () => {
      const longTitle = 'a'.repeat(250);
      const sessionData = {
        id: 'session-1',
        title: longTitle,
        messages: [],
      };
      const result = ValidationService.validateSessionData(sessionData);
      expect(result.title.length).toBe(200);
    });

    it('should sanitize message content', () => {
      const sessionData = {
        id: 'session-1',
        title: 'Test',
        messages: [{ role: 'user', content: '<script>alert(1)</script>Hello' }],
      };
      const result = ValidationService.validateSessionData(sessionData);
      expect(result.messages[0].content).not.toContain('<script>');
    });
  });

  describe('sanitizeMessageContent', () => {
    it('should return empty string for falsy input', () => {
      expect(ValidationService.sanitizeMessageContent('')).toBe('');
      expect(ValidationService.sanitizeMessageContent(null as any)).toBe('');
    });

    it('should remove script tags', () => {
      const content = 'Hello<script>alert("xss")</script>World';
      expect(ValidationService.sanitizeMessageContent(content)).toBe('HelloWorld');
    });

    it('should remove iframe tags', () => {
      const content = 'Hello<iframe src="evil.com"></iframe>World';
      expect(ValidationService.sanitizeMessageContent(content)).toBe('HelloWorld');
    });

    it('should remove object tags', () => {
      const content = 'Hello<object data="evil.swf"></object>World';
      expect(ValidationService.sanitizeMessageContent(content)).toBe('HelloWorld');
    });

    it('should remove embed tags', () => {
      const content = 'Hello<embed src="evil.swf"></embed>World';
      expect(ValidationService.sanitizeMessageContent(content)).toBe('HelloWorld');
    });

    it('should remove link tags', () => {
      const content = 'Hello<link rel="stylesheet" href="evil.css">World';
      expect(ValidationService.sanitizeMessageContent(content)).toBe('HelloWorld');
    });

    it('should remove style tags', () => {
      const content = 'Hello<style>body { display: none; }</style>World';
      expect(ValidationService.sanitizeMessageContent(content)).toBe('HelloWorld');
    });

    it('should remove event handlers', () => {
      const content = '<img src="x" onerror="alert(1)">';
      const result = ValidationService.sanitizeMessageContent(content);
      expect(result).not.toContain('onerror');
    });
  });

  describe('validateConfigValue', () => {
    it('should validate maxSessions within range', () => {
      expect(ValidationService.validateConfigValue('maxSessions', 50)).toBe(50);
    });

    it('should throw on maxSessions below minimum', () => {
      expect(() => ValidationService.validateConfigValue('maxSessions', 0)).toThrow(
        'Max sessions must be between 1 and 1000'
      );
    });

    it('should throw on maxSessions above maximum', () => {
      expect(() => ValidationService.validateConfigValue('maxSessions', 1001)).toThrow(
        'Max sessions must be between 1 and 1000'
      );
    });

    it('should validate tokenLimit within range', () => {
      expect(ValidationService.validateConfigValue('tokenLimit', 5000)).toBe(5000);
    });

    it('should throw on tokenLimit below minimum', () => {
      expect(() => ValidationService.validateConfigValue('tokenLimit', 50)).toThrow(
        'Token limit must be between 100 and 100000'
      );
    });

    it('should validate logLevel', () => {
      expect(ValidationService.validateConfigValue('logLevel', 'debug')).toBe('debug');
      expect(ValidationService.validateConfigValue('logLevel', 'info')).toBe('info');
      expect(ValidationService.validateConfigValue('logLevel', 'warn')).toBe('warn');
      expect(ValidationService.validateConfigValue('logLevel', 'error')).toBe('error');
    });

    it('should throw on invalid logLevel', () => {
      expect(() => ValidationService.validateConfigValue('logLevel', 'verbose')).toThrow('Log level must be one of');
    });

    it('should validate streamingDelay within range', () => {
      expect(ValidationService.validateConfigValue('streamingDelay', 100)).toBe(100);
    });

    it('should throw on streamingDelay below minimum', () => {
      expect(() => ValidationService.validateConfigValue('streamingDelay', -1)).toThrow(
        'Streaming delay must be between 0 and 1000ms'
      );
    });

    it('should throw on unknown key with too long value', () => {
      const longValue = 'a'.repeat(1001);
      expect(() => ValidationService.validateConfigValue('unknownKey', longValue)).toThrow(
        'Configuration value too long'
      );
    });

    it('should accept unknown key with valid value', () => {
      expect(ValidationService.validateConfigValue('unknownKey', 'valid')).toBe('valid');
    });
  });

  describe('sanitizeHTML', () => {
    it('should escape ampersand', () => {
      expect(ValidationService.sanitizeHTML('a & b')).toBe('a &amp; b');
    });

    it('should escape less than', () => {
      expect(ValidationService.sanitizeHTML('<tag>')).toBe('&lt;tag&gt;');
    });

    it('should escape quotes', () => {
      expect(ValidationService.sanitizeHTML('"test"')).toBe('&quot;test&quot;');
    });

    it('should escape single quotes', () => {
      expect(ValidationService.sanitizeHTML("it's")).toBe('it&#x27;s');
    });

    it('should escape forward slash', () => {
      expect(ValidationService.sanitizeHTML('a/b')).toBe('a&#x2F;b');
    });
  });

  describe('validateJSON', () => {
    it('should parse valid JSON', () => {
      const result = ValidationService.validateJSON('{"key": "value"}');
      expect(result).toEqual({ key: 'value' });
    });

    it('should throw on empty string', () => {
      expect(() => ValidationService.validateJSON('')).toThrow('Invalid JSON format');
    });

    it('should throw on null', () => {
      expect(() => ValidationService.validateJSON(null as any)).toThrow('Invalid JSON format');
    });

    it('should throw on invalid JSON', () => {
      expect(() => ValidationService.validateJSON('{invalid}')).toThrow('Invalid JSON format');
    });

    it('should throw on JSON exceeding size limit', () => {
      const largeJson = '{"key": "' + 'a'.repeat(1024 * 1024 + 1) + '"}';
      expect(() => ValidationService.validateJSON(largeJson)).toThrow('JSON string exceeds maximum size of 1MB');
    });
  });

  describe('validateFileName', () => {
    it('should accept valid file name', () => {
      expect(ValidationService.validateFileName('document.txt')).toBe('document.txt');
    });

    it('should throw on empty file name', () => {
      expect(() => ValidationService.validateFileName('')).toThrow('File name must be a non-empty string');
    });

    it('should throw on null file name', () => {
      expect(() => ValidationService.validateFileName(null as any)).toThrow('File name must be a non-empty string');
    });

    it('should throw on file name exceeding max length', () => {
      const longName = 'a'.repeat(256);
      expect(() => ValidationService.validateFileName(longName)).toThrow(
        'File name exceeds maximum length of 255 characters'
      );
    });

    it('should throw on path traversal with ../', () => {
      expect(() => ValidationService.validateFileName('../etc/passwd')).toThrow(
        'File name contains invalid characters'
      );
    });

    it('should throw on absolute path starting with /', () => {
      expect(() => ValidationService.validateFileName('/etc/passwd')).toThrow('File name contains invalid characters');
    });

    it('should throw on null bytes', () => {
      expect(() => ValidationService.validateFileName('file\x00.txt')).toThrow('File name contains invalid characters');
    });
  });

  describe('validateAPIKey', () => {
    it('should accept valid API key', () => {
      expect(ValidationService.validateAPIKey('sk-1234567890abcdef')).toBe('sk-1234567890abcdef');
    });

    it('should throw on empty API key', () => {
      expect(() => ValidationService.validateAPIKey('')).toThrow('API key cannot be empty');
    });

    it('should throw on null API key', () => {
      expect(() => ValidationService.validateAPIKey(null as any)).toThrow('API key cannot be empty');
    });

    it('should throw on API key exceeding max length', () => {
      const longKey = 'a'.repeat(513);
      expect(() => ValidationService.validateAPIKey(longKey)).toThrow('API key exceeds maximum length');
    });

    it('should throw on API key with control characters', () => {
      expect(() => ValidationService.validateAPIKey('key\x00value')).toThrow('API key contains invalid characters');
    });
  });

  describe('validateCustomSystemPrompt', () => {
    it('should accept valid prompt when required', () => {
      expect(ValidationService.validateCustomSystemPrompt('You are a helpful assistant', true)).toBe(
        'You are a helpful assistant'
      );
    });

    it('should throw on empty prompt when required', () => {
      expect(() => ValidationService.validateCustomSystemPrompt('', true)).toThrow(
        'Custom system prompt is required'
      );
    });

    it('should throw on whitespace-only prompt when required', () => {
      expect(() => ValidationService.validateCustomSystemPrompt('   ', true)).toThrow(
        'Custom system prompt cannot be empty'
      );
    });

    it('should return empty string when not required and empty', () => {
      expect(ValidationService.validateCustomSystemPrompt('', false)).toBe('');
    });

    it('should throw on prompt exceeding max length', () => {
      const longPrompt = 'a'.repeat(15001);
      expect(() => ValidationService.validateCustomSystemPrompt(longPrompt, true)).toThrow(
        'Custom system prompt exceeds maximum length'
      );
    });

    it('should trim whitespace', () => {
      expect(ValidationService.validateCustomSystemPrompt('  trimmed  ', true)).toBe('trimmed');
    });

    it('should remove control characters', () => {
      expect(ValidationService.validateCustomSystemPrompt('Hello\x00World', true)).toBe('HelloWorld');
    });

    it('should return empty string when not required and undefined', () => {
      expect(ValidationService.validateCustomSystemPrompt(undefined as any, false)).toBe('');
    });

    it('should throw on prompt exceeding max length when not required', () => {
      const longPrompt = 'a'.repeat(15001);
      expect(() => ValidationService.validateCustomSystemPrompt(longPrompt, false)).toThrow(
        'Custom system prompt exceeds maximum length'
      );
    });

    it('should accept valid prompt when not required', () => {
      expect(ValidationService.validateCustomSystemPrompt('Optional prompt', false)).toBe('Optional prompt');
    });
  });

  describe('validateQuery LogQL', () => {
    it('should accept valid LogQL query with stream selector', () => {
      const query = '{job="varlogs"} |= "error"';
      expect(ValidationService.validateQuery(query, 'logql')).toBe(query);
    });

    it('should accept LogQL query without stream selectors but may warn', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const query = 'line_format "{{ .msg }}"';
      const result = ValidationService.validateQuery(query, 'logql');
      expect(result).toBe(query);
      consoleSpy.mockRestore();
    });
  });

  describe('validateQuery edge cases', () => {
    it('should throw on dangerous ALTER pattern', () => {
      expect(() => ValidationService.validateQuery('; ALTER TABLE users', 'promql')).toThrow(
        'Query contains potentially dangerous operations'
      );
    });

    it('should throw on dangerous CREATE pattern', () => {
      expect(() => ValidationService.validateQuery('; CREATE TABLE test', 'promql')).toThrow(
        'Query contains potentially dangerous operations'
      );
    });

    it('should throw on dangerous GRANT pattern', () => {
      expect(() => ValidationService.validateQuery('; GRANT ALL ON test', 'promql')).toThrow(
        'Query contains potentially dangerous operations'
      );
    });

    it('should throw on dangerous REVOKE pattern', () => {
      expect(() => ValidationService.validateQuery('; REVOKE ALL ON test', 'promql')).toThrow(
        'Query contains potentially dangerous operations'
      );
    });

    it('should throw on extra closing parenthesis', () => {
      expect(() => ValidationService.validateQuery('rate(http_requests[5m]))', 'promql')).toThrow(
        'Unbalanced parentheses'
      );
    });

    it('should throw on extra closing bracket', () => {
      expect(() => ValidationService.validateQuery('rate(http_requests[5m]])', 'promql')).toThrow(
        'Unbalanced brackets'
      );
    });

    it('should throw on extra closing brace', () => {
      expect(() => ValidationService.validateQuery('rate(http_requests{job="test"}})', 'promql')).toThrow(
        'Unbalanced braces'
      );
    });
  });

  describe('validateChatInput - observability label selectors', () => {
    it('should accept queries with action= and session= labels', () => {
      expect(ValidationService.validateChatInput('Filter by action=deploy and session=abc123')).toBe(
        'Filter by action=deploy and session=abc123'
      );
    });

    it('should accept queries with function= labels', () => {
      expect(ValidationService.validateChatInput('Show traces where function=handleRequest')).toBe(
        'Show traces where function=handleRequest'
      );
    });

    it('should accept queries mentioning javascript in logs', () => {
      expect(ValidationService.validateChatInput('I see javascript: errors in my browser logs')).toBe(
        'I see javascript: errors in my browser logs'
      );
    });
  });
});
