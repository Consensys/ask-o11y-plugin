/**
 * Input Validation Service
 * Provides comprehensive validation and sanitization for user inputs
 * to prevent XSS, injection attacks, and other security vulnerabilities
 */

export class ValidationService {
  // Maximum allowed input length to prevent DoS
  private static readonly MAX_INPUT_LENGTH = 10000;
  private static readonly MAX_URL_LENGTH = 2048;
  private static readonly MAX_QUERY_LENGTH = 5000;
  static readonly MAX_SYSTEM_PROMPT_LENGTH = 15000;

  /**
   * Helper to validate and trim a non-empty string
   */
  private static validateNonEmptyString(value: string, fieldName: string, maxLength: number): string {
    if (!value || typeof value !== 'string') {
      throw new Error(`${fieldName} must be a non-empty string`);
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
      throw new Error(`${fieldName} cannot be empty`);
    }

    if (trimmed.length > maxLength) {
      throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters`);
    }

    return trimmed;
  }

  /**
   * Validates and sanitizes user chat input
   * @param input Raw user input
   * @returns Sanitized input or throws error if invalid
   */
  static validateChatInput(input: string): string {
    const trimmed = this.validateNonEmptyString(input, 'Input', this.MAX_INPUT_LENGTH);
    const cleaned = this.removeControlCharacters(trimmed);

    if (this.containsScriptInjection(cleaned)) {
      throw new Error('Input contains potentially harmful content');
    }

    return cleaned;
  }

  /**
   * Validates PromQL/LogQL queries
   * @param query Query string
   * @param language Query language (promql or logql)
   * @returns Validated query or throws error
   */
  static validateQuery(query: string, language: 'promql' | 'logql'): string {
    const trimmed = this.validateNonEmptyString(query, 'Query', this.MAX_QUERY_LENGTH);

    // Basic validation for common injection patterns
    const dangerousPatterns = [
      /;[\s]*drop/i,
      /;[\s]*delete/i,
      /;[\s]*truncate/i,
      /;[\s]*alter/i,
      /;[\s]*create/i,
      /;[\s]*grant/i,
      /;[\s]*revoke/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmed)) {
        throw new Error('Query contains potentially dangerous operations');
      }
    }

    // Language-specific validation
    if (language === 'promql') {
      this.validatePromQL(trimmed);
    } else if (language === 'logql') {
      this.validateLogQL(trimmed);
    }

    return trimmed;
  }

  /**
   * Validates MCP server URLs
   * @param url Server URL
   * @returns Validated URL or throws error
   */
  static validateMCPServerURL(url: string): string {
    const trimmed = this.validateNonEmptyString(url, 'URL', this.MAX_URL_LENGTH);

    try {
      const parsed = new URL(trimmed);

      // Only allow http and https protocols
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only HTTP and HTTPS protocols are allowed');
      }

      // Prevent localhost and private network access in production
      // if (this.isProductionEnvironment()) {
      //   if (this.isPrivateNetwork(parsed.hostname)) {
      //     throw new Error('Access to private networks is not allowed');
      //   }
      // }

      return trimmed;
    } catch (error) {
      if (error instanceof Error && error.message.includes('private')) {
        throw error;
      }
      throw new Error('Invalid URL format');
    }
  }

  /**
   * Validates session data for import
   * @param sessionData Raw session data
   * @returns Validated session data or throws error
   */
  static validateSessionData(sessionData: any): any {
    if (!sessionData || typeof sessionData !== 'object') {
      throw new Error('Session data must be an object');
    }

    // Check required fields
    if (!sessionData.id || typeof sessionData.id !== 'string') {
      throw new Error('Session must have a valid ID');
    }

    if (!sessionData.title || typeof sessionData.title !== 'string') {
      throw new Error('Session must have a valid title');
    }

    if (!Array.isArray(sessionData.messages)) {
      throw new Error('Session must have a messages array');
    }

    // Validate each message
    for (const message of sessionData.messages) {
      if (!message.role || !['user', 'assistant', 'tool'].includes(message.role)) {
        throw new Error('Invalid message role');
      }

      if (typeof message.content !== 'string') {
        throw new Error('Message content must be a string');
      }

      // Sanitize message content
      message.content = this.sanitizeMessageContent(message.content);
    }

    // Validate title length
    if (sessionData.title.length > 200) {
      sessionData.title = sessionData.title.substring(0, 200);
    }

    return sessionData;
  }

  /**
   * Sanitizes message content for safe display
   * @param content Message content
   * @returns Sanitized content
   */
  static sanitizeMessageContent(content: string): string {
    if (!content) {
      return '';
    }

    // Remove potentially dangerous HTML tags
    const sanitized = content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
      .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
      .replace(/<link\b[^>]*>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Remove event handlers
    const eventHandlerPattern = /\s*on\w+\s*=\s*["']?[^"']*["']?/gi;
    return sanitized.replace(eventHandlerPattern, '');
  }

  /**
   * Escapes HTML entities to prevent XSS
   * @param text Text to escape
   * @returns Escaped text
   */
  static escapeHTML(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Validates configuration values
   * @param key Configuration key
   * @param value Configuration value
   * @returns Validated value or throws error
   */
  static validateConfigValue(key: string, value: any): any {
    const configValidators: Record<string, (val: any) => any> = {
      maxSessions: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 1 || num > 1000) {
          throw new Error('Max sessions must be between 1 and 1000');
        }
        return num;
      },
      tokenLimit: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 100 || num > 100000) {
          throw new Error('Token limit must be between 100 and 100000');
        }
        return num;
      },
      logLevel: (val) => {
        const validLevels = ['debug', 'info', 'warn', 'error'];
        if (!validLevels.includes(val)) {
          throw new Error(`Log level must be one of: ${validLevels.join(', ')}`);
        }
        return val;
      },
      streamingDelay: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 0 || num > 1000) {
          throw new Error('Streaming delay must be between 0 and 1000ms');
        }
        return num;
      },
    };

    const validator = configValidators[key];
    if (validator) {
      return validator(value);
    }

    // Default validation for unknown keys
    if (typeof value === 'string' && value.length > 1000) {
      throw new Error('Configuration value too long');
    }

    return value;
  }

  // Private helper methods

  /**
   * Removes null bytes and control characters (except newlines and tabs)
   * @param input String to clean
   * @returns Cleaned string
   */
  private static removeControlCharacters(input: string): string {
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  private static containsScriptInjection(input: string): boolean {
    const dangerousPatterns = [
      /<script\b/i,
      /javascript:/i,
      /on\w+\s*=/i, // Event handlers
      /<iframe/i,
      /<object/i,
      /<embed/i,
      /eval\s*\(/i,
      /expression\s*\(/i,
      /vbscript:/i,
      /data:text\/html/i,
    ];

    return dangerousPatterns.some((pattern) => pattern.test(input));
  }

  /**
   * Check if brackets are balanced in a string
   */
  private static checkBalancedBrackets(query: string, openChar: string, closeChar: string, bracketName: string): void {
    let count = 0;
    for (const char of query) {
      if (char === openChar) {
        count++;
      } else if (char === closeChar) {
        count--;
      }
      if (count < 0) {
        throw new Error(`Unbalanced ${bracketName} in PromQL query`);
      }
    }
    if (count !== 0) {
      throw new Error(`Unbalanced ${bracketName} in PromQL query`);
    }
  }

  private static validatePromQL(query: string): void {
    this.checkBalancedBrackets(query, '(', ')', 'parentheses');
    this.checkBalancedBrackets(query, '[', ']', 'brackets');
    this.checkBalancedBrackets(query, '{', '}', 'braces');
  }

  private static validateLogQL(query: string): void {
    // Basic LogQL structure validation
    // Similar to PromQL but with LogQL-specific checks

    // Check for balanced brackets and quotes
    this.validatePromQL(query); // Reuse basic structure validation

    // LogQL-specific: Check for valid stream selectors
    if (!query.includes('{') && !query.includes('}')) {
      // LogQL queries should typically have stream selectors (warning silenced)
    }
  }

  /**
   * Sanitize HTML content
   */
  static sanitizeHTML(html: string): string {
    const replacements: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;',
    };

    return html.replace(/[&<>"'\/]/g, (char) => replacements[char]);
  }

  /**
   * Validate JSON string
   */
  static validateJSON(jsonString: string): any {
    if (!jsonString || typeof jsonString !== 'string') {
      throw new Error('Invalid JSON format');
    }

    // Check size limit (1MB)
    if (jsonString.length > 1024 * 1024) {
      throw new Error('JSON string exceeds maximum size of 1MB');
    }

    try {
      return JSON.parse(jsonString);
    } catch (error) {
      throw new Error('Invalid JSON format');
    }
  }

  /**
   * Validate file name
   */
  static validateFileName(fileName: string): string {
    if (!fileName || typeof fileName !== 'string') {
      throw new Error('File name must be a non-empty string');
    }

    if (fileName.length > 255) {
      throw new Error('File name exceeds maximum length of 255 characters');
    }

    // Check for path traversal attempts
    if (fileName.includes('../') || fileName.includes('..\\') || fileName.startsWith('/')) {
      throw new Error('File name contains invalid characters');
    }

    // Check for invalid characters
    const invalidChars = /[\x00-\x1f\x7f<>:"|?*\\]/;
    if (invalidChars.test(fileName)) {
      throw new Error('File name contains invalid characters');
    }

    return fileName;
  }

  /**
   * Validate API key
   */
  static validateAPIKey(apiKey: string): string {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('API key cannot be empty');
    }

    if (apiKey.length > 512) {
      throw new Error('API key exceeds maximum length');
    }

    // Check for control characters
    const controlChars = /[\x00-\x1f\x7f]/;
    if (controlChars.test(apiKey)) {
      throw new Error('API key contains invalid characters');
    }

    return apiKey;
  }

  /**
   * Validates custom system prompt
   * @param prompt Custom system prompt string
   * @param isRequired Whether the prompt is required (when mode is replace or append)
   * @returns Validated prompt or throws error
   */
  static validateCustomSystemPrompt(prompt: string, isRequired: boolean): string {
    // Handle empty/invalid prompt
    if (!prompt || typeof prompt !== 'string') {
      if (isRequired) {
        throw new Error('Custom system prompt is required');
      }
      return '';
    }

    const trimmed = prompt.trim();

    // Handle empty trimmed prompt
    if (trimmed.length === 0) {
      if (isRequired) {
        throw new Error('Custom system prompt cannot be empty');
      }
      return '';
    }

    // Check length limit
    if (trimmed.length > this.MAX_SYSTEM_PROMPT_LENGTH) {
      throw new Error(`Custom system prompt exceeds maximum length of ${this.MAX_SYSTEM_PROMPT_LENGTH} characters`);
    }

    return this.removeControlCharacters(trimmed);
  }
}

// Export validation functions for convenience
export const {
  validateChatInput,
  validateQuery,
  validateMCPServerURL,
  validateSessionData,
  sanitizeMessageContent,
  escapeHTML,
  validateConfigValue,
  validateCustomSystemPrompt,
} = ValidationService;
