import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface MCPToolResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class McpService {
  private readonly mcpServerUrl: string;

  constructor() {
    this.mcpServerUrl = environment.production 
      ? 'https://your-project.cloudfunctions.net/mcpWeatherServer'
      : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1/mcpWeatherServer';
  }

  async initialize(): Promise<any> {
    const response = await fetch(`${this.mcpServerUrl}/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize'
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to initialize MCP server: ${response.statusText}`);
    }

    return response.json();
  }

  async getTools(): Promise<MCPTool[]> {
    const response = await fetch(`${this.mcpServerUrl}/tools/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to get tools: ${response.statusText}`);
    }

    const data = await response.json();
    return data.result?.tools || [];
  }

  async callTool(toolCall: MCPToolCall): Promise<MCPToolResult> {
    const response = await fetch(`${this.mcpServerUrl}/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        params: {
          name: toolCall.name,
          arguments: toolCall.arguments
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to call tool: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(`Tool call error: ${data.error.message}`);
    }

    return data.result;
  }

  createEventSource(): EventSource {
    return new EventSource(`${this.mcpServerUrl}/events`);
  }
}