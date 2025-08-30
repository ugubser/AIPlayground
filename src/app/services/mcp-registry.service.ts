import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface McpServerConfig {
  id: string;
  name: string;
  description: string;
  url: string;
  type: 'http' | 'websocket';
  enabled: boolean;
  status: 'unknown' | 'online' | 'offline' | 'error';
  tools?: McpTool[];
  lastChecked?: Date;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
  serverId: string; // Which server provides this tool
}

export interface McpToolCall {
  serverId: string;
  toolName: string;
  arguments: Record<string, any>;
}

export interface McpToolResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class McpRegistryService {
  private serversSubject = new BehaviorSubject<McpServerConfig[]>([]);
  public servers$: Observable<McpServerConfig[]> = this.serversSubject.asObservable();

  private availableToolsSubject = new BehaviorSubject<McpTool[]>([]);
  public availableTools$: Observable<McpTool[]> = this.availableToolsSubject.asObservable();

  constructor() {
    this.initializeDefaultServers();
  }

  private initializeDefaultServers() {
    const defaultServers: McpServerConfig[] = [
      {
        id: 'weather-local',
        name: 'Weather Server',
        description: 'Local weather and forecast data via OpenMeteo APIs',
        url: environment.production 
          ? 'https://us-central1-aiplayground-6e5be.cloudfunctions.net/mcpWeatherServer'
          : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1/mcpWeatherServer',
        type: 'http',
        enabled: true,
        status: 'unknown'
      },
      {
        id: 'yfinance-local',
        name: 'Yahoo Finance Server',
        description: 'Stock market data and financial metrics via Yahoo Finance APIs',
        url: environment.production 
          ? 'https://us-central1-aiplayground-6e5be.cloudfunctions.net/mcpYFinanceServer'
          : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1/mcpYFinanceServer',
        type: 'http',
        enabled: false,
        status: 'unknown'
      }
    ];

    this.serversSubject.next(defaultServers);
  }

  getServers(): McpServerConfig[] {
    return this.serversSubject.value;
  }

  getEnabledServers(): McpServerConfig[] {
    return this.serversSubject.value.filter(server => server.enabled);
  }

  getAvailableTools(): McpTool[] {
    return this.availableToolsSubject.value;
  }

  async toggleServer(serverId: string, enabled: boolean): Promise<void> {
    const servers = this.serversSubject.value.map(server => 
      server.id === serverId ? { ...server, enabled } : server
    );
    
    this.serversSubject.next(servers);
    
    if (enabled) {
      await this.initializeServer(serverId);
    }
    
    await this.updateAvailableTools();
  }

  async initializeServer(serverId: string): Promise<boolean> {
    const servers = this.serversSubject.value;
    const server = servers.find(s => s.id === serverId);
    
    if (!server) {
      console.error('Server not found:', serverId);
      return false;
    }

    try {
      console.log(`Initializing MCP server: ${server.name}`);
      
      // Initialize server
      const initResponse = await fetch(`${server.url}/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize'
        })
      });

      if (!initResponse.ok) {
        throw new Error(`Init failed: ${initResponse.status}`);
      }

      // Get tools list
      const toolsResponse = await fetch(`${server.url}/tools/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list'
        })
      });

      if (!toolsResponse.ok) {
        throw new Error(`Tools list failed: ${toolsResponse.status}`);
      }

      const toolsData = await toolsResponse.json();
      const tools = (toolsData.result?.tools || []).map((tool: any) => ({
        ...tool,
        serverId: server.id
      }));

      // Update server status and tools
      const updatedServers = servers.map(s => 
        s.id === serverId 
          ? { ...s, status: 'online' as const, tools, lastChecked: new Date() }
          : s
      );
      
      this.serversSubject.next(updatedServers);
      
      // Update the global available tools list
      await this.updateAvailableTools();
      
      console.log(`✅ ${server.name} initialized with ${tools.length} tools`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to initialize ${server.name}:`, error);
      
      // Update server status to error
      const updatedServers = servers.map(s => 
        s.id === serverId 
          ? { ...s, status: 'error' as const, lastChecked: new Date() }
          : s
      );
      
      this.serversSubject.next(updatedServers);
      return false;
    }
  }

  async callTool(toolCall: McpToolCall): Promise<McpToolResult> {
    const server = this.serversSubject.value.find(s => s.id === toolCall.serverId);
    
    if (!server) {
      throw new Error(`Server not found: ${toolCall.serverId}`);
    }

    if (!server.enabled || server.status !== 'online') {
      throw new Error(`Server not available: ${server.name}`);
    }

    const response = await fetch(`${server.url}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        params: {
          name: toolCall.toolName,
          arguments: toolCall.arguments
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Tool call failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(`Tool error: ${data.error.message}`);
    }

    return data.result;
  }

  private async updateAvailableTools(): Promise<void> {
    const enabledServers = this.getEnabledServers().filter(s => s.status === 'online');
    const allTools: McpTool[] = [];
    
    for (const server of enabledServers) {
      if (server.tools) {
        allTools.push(...server.tools);
      }
    }
    
    this.availableToolsSubject.next(allTools);
    console.log(`Updated available tools: ${allTools.length} tools from ${enabledServers.length} servers`);
  }

  async addCustomServer(config: Omit<McpServerConfig, 'id' | 'status' | 'enabled'>): Promise<void> {
    const newServer: McpServerConfig = {
      ...config,
      id: `custom-${Date.now()}`,
      enabled: false,
      status: 'unknown'
    };

    const servers = [...this.serversSubject.value, newServer];
    this.serversSubject.next(servers);
  }

  async removeServer(serverId: string): Promise<void> {
    const servers = this.serversSubject.value.filter(s => s.id !== serverId);
    this.serversSubject.next(servers);
    await this.updateAvailableTools();
  }

  async refreshServerStatus(serverId?: string): Promise<void> {
    const serversToCheck = serverId 
      ? this.serversSubject.value.filter(s => s.id === serverId)
      : this.getEnabledServers();

    for (const server of serversToCheck) {
      await this.initializeServer(server.id);
    }
  }
}