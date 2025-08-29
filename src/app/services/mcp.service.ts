import { Injectable } from '@angular/core';
import { McpRegistryService, McpToolCall, McpToolResult } from './mcp-registry.service';

@Injectable({
  providedIn: 'root'
})
export class McpService {
  constructor(private mcpRegistry: McpRegistryService) {}

  async callTool(toolCall: { name: string; arguments: Record<string, any> }): Promise<McpToolResult> {
    // Find which server provides this tool
    const availableTools = this.mcpRegistry.getAvailableTools();
    const tool = availableTools.find(t => t.name === toolCall.name);
    
    if (!tool) {
      throw new Error(`Tool not found: ${toolCall.name}`);
    }

    const mcpToolCall: McpToolCall = {
      serverId: tool.serverId,
      toolName: toolCall.name,
      arguments: toolCall.arguments
    };

    return this.mcpRegistry.callTool(mcpToolCall);
  }
}