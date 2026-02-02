import { Tool, CallToolRequest, CallToolResultSchema, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { MCPServerConfig } from '../types/plugin';

// Type inference from MCP SDK schemas
type CallToolParams = CallToolRequest['params'];
type CallToolResult = z.infer<typeof CallToolResultSchema>;

/**
 * External MCP Client for connecting to additional MCP servers
 * Supports both OpenAPI-based servers (like MCPO) and standard MCP servers
 */
export class ExternalMCPClient {
  private config: MCPServerConfig;
  private cachedTools: Tool[] | null = null;
  private cachedSpec: any = null;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  /**
   * Check if a tool name belongs to this MCP server
   */
  isTool(toolName: string): boolean {
    if (!this.cachedTools) {
      return false;
    }
    return this.cachedTools.some((tool) => tool.name === toolName);
  }

  /**
   * Build input schema from OpenAPI operation
   */
  private buildInputSchemaFromOperation(operation: any): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Add path and query parameters
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (param.in === 'path' || param.in === 'query') {
          properties[param.name] = {
            type: param.schema?.type || 'string',
            description: param.description,
          };

          if (param.required) {
            required.push(param.name);
          }
        }
      }
    }

    // Add request body schema
    if (operation.requestBody && operation.requestBody.content) {
      const jsonContent = operation.requestBody.content['application/json'];
      if (jsonContent && jsonContent.schema) {
        const bodySchema = jsonContent.schema;
        if (bodySchema.properties) {
          Object.assign(properties, bodySchema.properties);
        }
        if (bodySchema.required) {
          required.push(...bodySchema.required);
        }
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  /**
   * List available tools from the MCP server
   */
  async listTools(): Promise<ListToolsResult> {
    if (!this.config.enabled) {
      return { tools: [] };
    }

    try {
      // For OpenAPI-based servers
      if (this.config.type === 'openapi') {
        // Fetch the OpenAPI specification
        const specUrl = this.config.url.endsWith('/openapi.json')
          ? this.config.url
          : this.config.url.endsWith('/')
          ? `${this.config.url}openapi.json`
          : `${this.config.url}/openapi.json`;

        const response = await fetch(specUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...this.config.headers,
          },
        });

        if (!response.ok) {
          return { tools: [] };
        }

        const openApiSpec = await response.json();
        this.cachedSpec = openApiSpec; // Cache the spec for later use

        // Convert OpenAPI paths to MCP tools
        const tools: Tool[] = [];

        if (openApiSpec.paths) {
          for (const [path, pathItem] of Object.entries(openApiSpec.paths)) {
            for (const [method, operation] of Object.entries(pathItem as any)) {
              if (
                typeof operation === 'object' &&
                operation &&
                ['get', 'post', 'put', 'delete', 'patch'].includes(method)
              ) {
                const operationObj = operation as any;
                const toolName =
                  operationObj.operationId ||
                  `${method}_${path
                    .replace(/[{}\/]/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_|_$/g, '')}`;

                tools.push({
                  name: toolName,
                  description: operationObj.description || operationObj.summary || `${method.toUpperCase()} ${path}`,
                  inputSchema: this.buildInputSchemaFromOperation(operationObj),
                });
              }
            }
          }
        }

        this.cachedTools = tools;

        return {
          tools,
          _meta: {
            totalCount: tools.length,
          },
        };
      }

      // For standard MCP servers
      const url = this.config.url.endsWith('/')
        ? `${this.config.url}mcp/list-tools`
        : `${this.config.url}/mcp/list-tools`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        return { tools: [] };
      }

      const result = await response.json();
      this.cachedTools = result.tools || [];

      return result;
    } catch (error) {
      return { tools: [] };
    }
  }

  /**
   * Execute an OpenAPI operation based on tool name
   */
  private async executeOpenAPIOperation(toolName: string, args: any): Promise<CallToolResult> {
    try {
      // Use cached spec if available, otherwise fetch it
      let openApiSpec = this.cachedSpec;

      if (!openApiSpec) {
        const specUrl = this.config.url.endsWith('/openapi.json')
          ? this.config.url
          : this.config.url.endsWith('/')
          ? `${this.config.url}openapi.json`
          : `${this.config.url}/openapi.json`;

        const specResponse = await fetch(specUrl, {
          headers: {
            'Content-Type': 'application/json',
            ...this.config.headers,
          },
        });

        if (!specResponse.ok) {
          throw new Error(`Failed to fetch OpenAPI spec: ${specResponse.statusText}`);
        }

        openApiSpec = await specResponse.json();
        this.cachedSpec = openApiSpec; // Cache for future use
      }

      // Find the operation matching the tool name
      for (const [path, pathItem] of Object.entries(openApiSpec.paths || {})) {
        for (const [method, operation] of Object.entries(pathItem as any)) {
          if (
            typeof operation === 'object' &&
            operation &&
            ['get', 'post', 'put', 'delete', 'patch'].includes(method)
          ) {
            const operationObj = operation as any;
            const operationId =
              operationObj.operationId ||
              `${method}_${path
                .replace(/[{}\/]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '')}`;

            if (operationId === toolName) {
              // Build the actual API URL
              const baseUrl = this.config.url.replace(/\/openapi\.json$/, '');
              let apiUrl = baseUrl + path;
              const queryParams: string[] = [];
              const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...this.config.headers,
              };

              // Process path parameters
              if (operationObj.parameters) {
                for (const param of operationObj.parameters) {
                  const value = args[param.name];
                  if (param.in === 'path') {
                    apiUrl = apiUrl.replace(`{${param.name}}`, encodeURIComponent(value || ''));
                  } else if (param.in === 'query' && value !== undefined) {
                    queryParams.push(`${param.name}=${encodeURIComponent(value)}`);
                  } else if (param.in === 'header') {
                    headers[param.name] = String(value);
                  }
                }
              }

              // Add query parameters
              if (queryParams.length > 0) {
                apiUrl += '?' + queryParams.join('&');
              }

              // Prepare request body (for POST, PUT, PATCH)
              let body: string | undefined;
              if (['post', 'put', 'patch'].includes(method.toLowerCase()) && operationObj.requestBody) {
                const bodyData = { ...args };
                // Remove parameters that were used in path/query/header
                if (operationObj.parameters) {
                  for (const param of operationObj.parameters) {
                    delete bodyData[param.name];
                  }
                }
                body = JSON.stringify(bodyData);
              }

              // Execute the API call
              const response = await fetch(apiUrl, {
                method: method.toUpperCase(),
                headers,
                body,
              });

              const contentType = response.headers.get('content-type');
              let result: any;

              if (contentType?.includes('application/json')) {
                result = await response.json();
              } else {
                result = await response.text();
              }

              if (!response.ok) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `API Error (${response.status}): ${
                        typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                      }`,
                    },
                  ],
                  isError: true,
                };
              }

              return {
                content: [
                  {
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                  },
                ],
              };
            }
          }
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Tool ${toolName} not found in OpenAPI specification`,
          },
        ],
        isError: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `Error executing OpenAPI operation: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(params: CallToolParams): Promise<CallToolResult> {
    if (!this.config.enabled) {
      return {
        content: [
          {
            type: 'text',
            text: `MCP server ${this.config.name} is disabled`,
          },
        ],
        isError: true,
      };
    }

    try {
      // For OpenAPI-based servers, execute the operation directly from the spec
      if (this.config.type === 'openapi') {
        return await this.executeOpenAPIOperation(params.name, params.arguments || {});
      }

      // For standard MCP servers
      const url = this.config.url.endsWith('/')
        ? `${this.config.url}mcp/call-tool`
        : `${this.config.url}/mcp/call-tool`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [
            {
              type: 'text',
              text: `Error calling tool ${params.name}: ${response.statusText}\n${errorText}`,
            },
          ],
          isError: true,
        };
      }

      const result = await response.json();
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        content: [
          {
            type: 'text',
            text: `Error calling tool ${params.name} on ${this.config.name}: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Get the server configuration
   */
  getConfig(): MCPServerConfig {
    return this.config;
  }
}

/**
 * Manager for multiple external MCP clients
 */
export class ExternalMCPManager {
  private clients: Map<string, ExternalMCPClient> = new Map();

  /**
   * Initialize clients from configurations
   */
  initialize(configs: MCPServerConfig[]) {
    this.clients.clear();

    for (const config of configs) {
      if (config.enabled && config.url) {
        const client = new ExternalMCPClient(config);
        this.clients.set(config.id, client);
      }
    }
  }

  /**
   * List all tools from all configured MCP servers
   */
  async listAllTools(): Promise<Tool[]> {
    const allTools: Tool[] = [];

    for (const [, client] of this.clients.entries()) {
      try {
        const result = await client.listTools();
        allTools.push(...result.tools);
      } catch (error) {
        // Silently handle errors from individual clients
      }
    }

    return allTools;
  }

  /**
   * Find which client handles a given tool and call it
   */
  async callTool(params: CallToolParams): Promise<CallToolResult | null> {
    for (const client of this.clients.values()) {
      if (client.isTool(params.name)) {
        return await client.callTool(params);
      }
    }

    return null;
  }

  /**
   * Check if any client handles this tool
   */
  isTool(toolName: string): boolean {
    for (const client of this.clients.values()) {
      if (client.isTool(toolName)) {
        return true;
      }
    }
    return false;
  }
}

// Export singleton instance
export const externalMCPManager = new ExternalMCPManager();
