#!/usr/bin/env node

import * as readline from 'readline';

interface MCPMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

class MCPWeatherServer {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      crlfDelay: Infinity
    });

    this.rl.on('line', (line) => {
      this.handleMessage(line.trim());
    });

    process.stderr.write('MCP Weather Server started\n');
  }

  private handleMessage(line: string) {
    if (!line) return;

    try {
      const message: MCPMessage = JSON.parse(line);
      this.processMessage(message);
    } catch (error) {
      process.stderr.write(`Error parsing message: ${error}\n`);
      this.sendError(undefined, -32700, 'Parse error');
    }
  }

  private processMessage(message: MCPMessage) {
    const { method, id, params } = message;

    switch (method) {
      case 'initialize':
        this.handleInitialize(id);
        break;
      case 'tools/list':
        this.handleToolsList(id);
        break;
      case 'tools/call':
        this.handleToolCall(id, params);
        break;
      default:
        this.sendError(id, -32601, `Method not found: ${method}`);
    }
  }

  private handleInitialize(id?: number | string) {
    this.sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'weather-server',
        version: '1.0.0'
      }
    });
  }

  private handleToolsList(id?: number | string) {
    this.sendResponse(id, {
      tools: [
        {
          name: 'get_weather',
          description: 'Get current weather for a city',
          inputSchema: {
            type: 'object',
            properties: {
              city: {
                type: 'string',
                description: 'The city to get weather for'
              }
            },
            required: ['city']
          }
        }
      ]
    });
  }

  private handleToolCall(id?: number | string, params?: any) {
    const { name, arguments: toolArgs } = params || {};

    if (name === 'get_weather') {
      const city = toolArgs?.city || '';
      let weather = 'Dim';

      if (city.toLowerCase().includes('new york')) {
        weather = 'Sunny';
      } else if (city.toLowerCase().includes('zurich')) {
        weather = 'Rainy';
      }

      this.sendResponse(id, {
        content: [
          {
            type: 'text',
            text: `The weather in ${city} is ${weather}`
          }
        ]
      });
    } else {
      this.sendError(id, -32601, `Unknown tool: ${name}`);
    }
  }

  private sendResponse(id?: number | string, result?: any) {
    const response: MCPMessage = {
      jsonrpc: '2.0',
      id: id || 1,
      result
    };
    console.log(JSON.stringify(response));
  }

  private sendError(id: number | string | undefined, code: number, message: string, data?: any) {
    const response: MCPMessage = {
      jsonrpc: '2.0',
      id: id || 1,
      error: {
        code,
        message,
        data
      }
    };
    console.log(JSON.stringify(response));
  }
}

// Start the server
new MCPWeatherServer();