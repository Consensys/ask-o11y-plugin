import React, { useState, useEffect } from 'react';
import { Button, Field, Input, Modal, TextArea, CollapsableSection } from '@grafana/ui';
import { MCPServerConfig } from '../../types/plugin';

interface MCPServerModalProps {
  server: MCPServerConfig | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (server: MCPServerConfig) => void;
}

interface HeaderError {
  line: number;
  message: string;
}

export const MCPServerModal: React.FC<MCPServerModalProps> = ({ server, isOpen, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'openapi' | 'standard' | 'sse' | 'streamable-http'>('streamable-http');
  const [headersText, setHeadersText] = useState('');
  const [headerErrors, setHeaderErrors] = useState<HeaderError[]>([]);
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    if (server) {
      setName(server.name);
      setUrl(server.url);
      setType(server.type || 'streamable-http');

      // Convert headers object to text format
      if (server.headers && Object.keys(server.headers).length > 0) {
        const headersArray = Object.entries(server.headers).map(([key, value]) => `${key}: ${value}`);
        setHeadersText(headersArray.join('\n'));
      } else {
        setHeadersText('');
      }
    } else {
      // New server
      setName('');
      setUrl('');
      setType('streamable-http');
      setHeadersText('');
    }
    setHeaderErrors([]);
    setUrlError('');
  }, [server, isOpen]);

  const validateUrl = (urlValue: string): boolean => {
    if (!urlValue.trim()) {
      setUrlError('URL is required');
      return false;
    }
    try {
      new URL(urlValue);
      setUrlError('');
      return true;
    } catch {
      setUrlError('Invalid URL format');
      return false;
    }
  };

  const parseHeaders = (text: string): { headers: Record<string, string>; errors: HeaderError[] } => {
    const headers: Record<string, string> = {};
    const errors: HeaderError[] = [];
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return; // Skip empty lines
      }

      const colonIndex = trimmedLine.indexOf(':');
      if (colonIndex === -1) {
        errors.push({
          line: index + 1,
          message: 'Missing colon separator (expected format: Key: Value)',
        });
        return;
      }

      const key = trimmedLine.substring(0, colonIndex).trim();
      const value = trimmedLine.substring(colonIndex + 1).trim();

      if (!key) {
        errors.push({
          line: index + 1,
          message: 'Header key cannot be empty',
        });
        return;
      }

      if (!value) {
        errors.push({
          line: index + 1,
          message: 'Header value cannot be empty',
        });
        return;
      }

      if (headers[key]) {
        errors.push({
          line: index + 1,
          message: `Duplicate header key: "${key}"`,
        });
        return;
      }

      headers[key] = value;
    });

    return { headers, errors };
  };

  const handleHeadersChange = (text: string) => {
    setHeadersText(text);
    const { errors } = parseHeaders(text);
    setHeaderErrors(errors);
  };

  const handleSave = () => {
    // Validate URL
    if (!validateUrl(url)) {
      return;
    }

    // Parse and validate headers
    const { headers, errors } = parseHeaders(headersText);
    if (errors.length > 0) {
      setHeaderErrors(errors);
      return;
    }

    // Create updated server config
    const updatedServer: MCPServerConfig = {
      id: server?.id || `mcp-${Date.now()}`,
      name: name.trim(),
      url: url.trim(),
      type,
      enabled: server?.enabled ?? true,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    };

    onSave(updatedServer);
  };

  const handleCancel = () => {
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  const headerCount = headersText.trim() ? headersText.split('\n').filter((line) => line.trim()).length : 0;

  return (
    <Modal title={server ? 'Edit MCP Server' : 'Add MCP Server'} isOpen={isOpen} onDismiss={handleCancel}>
      <div className="space-y-4">
        <div>
          <h4 className="text-md font-medium mb-3">Server Details</h4>

          <Field label="Name" required invalid={!name.trim()} error={!name.trim() ? 'Name is required' : ''}>
            <Input
              value={name}
              placeholder="My MCP Server"
              onChange={(e) => setName(e.currentTarget.value)}
              data-testid="mcp-modal-name-input"
            />
          </Field>

          <Field label="URL" required invalid={!!urlError} error={urlError} className="mt-3">
            <Input
              value={url}
              placeholder="https://mcp-server.example.com"
              onChange={(e) => {
                setUrl(e.currentTarget.value);
                setUrlError('');
              }}
              onBlur={(e) => validateUrl(e.currentTarget.value)}
              data-testid="mcp-modal-url-input"
            />
          </Field>

          <Field label="Type" className="mt-3">
            <select
              className="gf-form-input"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              style={{ width: '100%', height: '32px' }}
              data-testid="mcp-modal-type-select"
            >
              <option value="streamable-http">Streamable HTTP</option>
              <option value="openapi">OpenAPI</option>
              <option value="standard">Standard MCP</option>
              <option value="sse">SSE</option>
            </select>
          </Field>
        </div>

        <CollapsableSection label={`Headers ${headerCount > 0 ? `(${headerCount} configured)` : ''}`} isOpen={false}>
          <div className="mt-2">
            <p className="text-xs text-secondary mb-2">
              Add custom HTTP headers to include with every request to this MCP server.
              <br />
              Format: <code>Key: Value</code> (one per line)
            </p>

            <Field
              label="Headers"
              description="Example: Authorization: Bearer token"
              invalid={headerErrors.length > 0}
            >
              <TextArea
                value={headersText}
                placeholder="Authorization: Bearer ${'{token}'}\nX-API-Key: ${'{apiKey}'}\nX-Custom-Header: static-value"
                onChange={(e) => handleHeadersChange(e.currentTarget.value)}
                rows={6}
                data-testid="mcp-modal-headers-textarea"
              />
            </Field>

            {headerErrors.length > 0 && (
              <div className="mt-2">
                {headerErrors.map((error, index) => (
                  <div key={index} className="text-xs text-error mb-1">
                    Line {error.line}: {error.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsableSection>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={handleCancel} data-testid="mcp-modal-cancel-button">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!name.trim() || !url.trim() || !!urlError || headerErrors.length > 0}
            data-testid="mcp-modal-save-button"
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};
