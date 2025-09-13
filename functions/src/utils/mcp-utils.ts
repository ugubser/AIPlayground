import { logger } from 'firebase-functions';
import fetch from 'node-fetch';

// Tool definition format for OpenAI-compatible LLMs
interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

// MCP server configurations with their tool endpoints
const MCP_SERVERS = [
  {
    id: 'weather-local',
    name: 'Weather Server',
    url: process.env.NODE_ENV === 'production'
      ? 'https://us-central1-aiplayground-6e5be.cloudfunctions.net/mcpWeatherServer'
      : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1/mcpWeatherServer'
  },
  {
    id: 'yfinance-local',
    name: 'Yahoo Finance Server',
    url: process.env.NODE_ENV === 'production'
      ? 'https://us-central1-aiplayground-6e5be.cloudfunctions.net/mcpYFinanceServer'
      : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1/mcpYFinanceServer'
  },
  {
    id: 'time-local',
    name: 'Time Server',
    url: process.env.NODE_ENV === 'production'
      ? 'https://us-central1-aiplayground-6e5be.cloudfunctions.net/mcpTimeServer'
      : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1/mcpTimeServer'
  },
  {
    id: 'unit-converter-local',
    name: 'Unit Converter Server',
    url: process.env.NODE_ENV === 'production'
      ? 'https://us-central1-aiplayground-6e5be.cloudfunctions.net/mcpUnitConverterServer'
      : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1/mcpUnitConverterServer'
  },
  {
    id: 'calculator-local',
    name: 'Calculator Server',
    url: process.env.NODE_ENV === 'production'
      ? 'https://us-central1-aiplayground-6e5be.cloudfunctions.net/mcpCalculatorServer'
      : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1/mcpCalculatorServer'
  },
  {
    id: 'currency-local',
    name: 'Currency Converter Server',
    url: process.env.NODE_ENV === 'production'
      ? 'https://us-central1-aiplayground-6e5be.cloudfunctions.net/mcpCurrencyServer'
      : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1/mcpCurrencyServer'
  }
];

export async function getToolDefinitionsFromServers(): Promise<ToolDefinition[]> {
  const allTools: ToolDefinition[] = [];

  for (const server of MCP_SERVERS) {
    try {
      // Get tools list from the server
      const toolsResponse = await fetch(`${server.url}/tools/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/list'
        })
      });

      if (!toolsResponse.ok) {
        logger.warn('Failed to get tools from server', {
          server: server.name,
          status: toolsResponse.status
        });
        continue;
      }

      const toolsData = await toolsResponse.json();
      const tools = toolsData.result?.tools || [];

      // Convert MCP tools to OpenAI tool format
      for (const mcpTool of tools) {
        const toolDef: ToolDefinition = {
          type: 'function',
          function: {
            name: mcpTool.name,
            description: mcpTool.description,
            parameters: {
              type: 'object',
              properties: mcpTool.inputSchema?.properties || {},
              required: mcpTool.inputSchema?.required || []
            }
          }
        };

        allTools.push(toolDef);
      }

      logger.info('Retrieved tools from server', {
        server: server.name,
        toolCount: tools.length,
        toolNames: tools.map((t: any) => t.name)
      });

    } catch (error: any) {
      logger.error('Error retrieving tools from server', {
        server: server.name,
        error: error.message
      });
    }
  }

  logger.info('Total tools available', {
    totalCount: allTools.length,
    toolNames: allTools.map(t => t.function.name)
  });

  return allTools;
}

export interface McpCallResult {
  result: any;
  promptData?: {
    mcpRequest: {
      server: string;
      toolName: string;
      arguments: Record<string, any>;
    };
    mcpResponse: {
      server: string;
      result: any;
    };
  };
}

export async function callMcpTool(toolName: string, arguments_: Record<string, any>, enablePromptLogging: boolean = false): Promise<McpCallResult> {
  // Find which server provides this tool
  for (const server of MCP_SERVERS) {
    try {
      // Check if this server has the tool
      const toolsResponse = await fetch(`${server.url}/tools/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/list'
        })
      });

      if (!toolsResponse.ok) continue;

      const toolsData = await toolsResponse.json();
      const tools = toolsData.result?.tools || [];
      const hasTool = tools.some((tool: any) => tool.name === toolName);

      if (!hasTool) continue;

      // Call the tool
      const callResponse = await fetch(`${server.url}/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          params: {
            name: toolName,
            arguments: arguments_
          }
        })
      });

      if (!callResponse.ok) {
        throw new Error(`Tool call failed: ${callResponse.statusText}`);
      }

      const callData = await callResponse.json();

      if (callData.error) {
        throw new Error(`Tool error: ${callData.error.message}`);
      }

      logger.info('MCP tool called successfully', {
        toolName,
        server: server.name,
        arguments: arguments_
      });

      const mcpResult: McpCallResult = {
        result: callData.result
      };

      // Add logging data if prompt logging is enabled
      if (enablePromptLogging) {
        mcpResult.promptData = {
          mcpRequest: {
            server: server.name,
            toolName,
            arguments: arguments_
          },
          mcpResponse: {
            server: server.name,
            result: callData.result
          }
        };
      }

      return mcpResult;

    } catch (error: any) {
      logger.error('Error calling MCP tool', {
        toolName,
        server: server.name,
        error: error.message
      });
    }
  }

  throw new Error(`Tool not found: ${toolName}`);
}

// Helper function to get server info for a specific tool
export async function getServerForTool(toolName: string): Promise<string | null> {
  for (const server of MCP_SERVERS) {
    try {
      const toolsResponse = await fetch(`${server.url}/tools/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/list'
        })
      });

      if (!toolsResponse.ok) continue;

      const toolsData = await toolsResponse.json();
      const tools = toolsData.result?.tools || [];
      const hasTool = tools.some((tool: any) => tool.name === toolName);

      if (hasTool) {
        return server.id;
      }
    } catch (error: any) {
      logger.error('Error checking server for tool', {
        toolName,
        server: server.name,
        error: error.message
      });
    }
  }

  return null;
}