import * as functions from 'firebase-functions';
import { FUNCTION_CONSTANTS } from './config/function-constants';

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

interface TimeResult {
  timezone: string;
  datetime: string;
  day_of_week: string;
  is_dst: boolean;
}

interface TimeConversionResult {
  source: TimeResult;
  target: TimeResult;
  time_difference: string;
}

class TimeMCPHandler {
  private getLocalTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  }

  private validateTimezone(timezone: string): void {
    try {
      Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch (error) {
      throw new Error(`Invalid timezone: ${timezone}`);
    }
  }

  private isDST(date: Date, timezone: string): boolean {
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);
    
    const janOffset = new Intl.DateTimeFormat('en', { 
      timeZone: timezone, 
      timeZoneName: 'longOffset' 
    }).formatToParts(jan).find(part => part.type === 'timeZoneName')?.value || '';
    
    const julOffset = new Intl.DateTimeFormat('en', { 
      timeZone: timezone, 
      timeZoneName: 'longOffset' 
    }).formatToParts(jul).find(part => part.type === 'timeZoneName')?.value || '';
    
    const currentOffset = new Intl.DateTimeFormat('en', { 
      timeZone: timezone, 
      timeZoneName: 'longOffset' 
    }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || '';
    
    return currentOffset !== janOffset && currentOffset === julOffset;
  }

  async handleInitialize(): Promise<any> {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'time-server',
        version: '1.0.0'
      }
    };
  }

  async handleToolsList(): Promise<{ tools: MCPTool[] }> {
    const localTz = this.getLocalTimezone();
    
    return {
      tools: [
        {
          name: 'get_current_time',
          description: 'Get current time in a specific timezone',
          inputSchema: {
            type: 'object',
            properties: {
              timezone: {
                type: 'string',
                description: `IANA timezone name (e.g., 'America/New_York', 'Europe/London'). Use '${localTz}' as local timezone if no timezone provided by the user.`
              }
            },
            required: ['timezone']
          }
        },
        {
          name: 'convert_time',
          description: 'Convert time between timezones',
          inputSchema: {
            type: 'object',
            properties: {
              source_timezone: {
                type: 'string',
                description: `Source IANA timezone name (e.g., 'America/New_York', 'Europe/London'). Use '${localTz}' as local timezone if no source timezone provided by the user.`
              },
              time: {
                type: 'string',
                description: 'Time to convert in 24-hour format (HH:MM)'
              },
              target_timezone: {
                type: 'string',
                description: `Target IANA timezone name (e.g., 'Asia/Tokyo', 'America/San_Francisco'). Use '${localTz}' as local timezone if no target timezone provided by the user.`
              }
            },
            required: ['source_timezone', 'time', 'target_timezone']
          }
        }
      ]
    };
  }

  async handleToolCall(params: any): Promise<any> {
    const { name, arguments: toolArgs } = params || {};

    if (name === 'get_current_time') {
      const timezone = toolArgs?.timezone || '';
      
      try {
        this.validateTimezone(timezone);
        
        const now = new Date();
        const timeInTz = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(now);
        
        const dayOfWeek = new Intl.DateTimeFormat('en', {
          timeZone: timezone,
          weekday: 'long'
        }).format(now);
        
        const isDst = this.isDST(now, timezone);
        
        // Convert to ISO format
        const isoDateTime = timeInTz.replace(/(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6');
        
        const result: TimeResult = {
          timezone,
          datetime: isoDateTime,
          day_of_week: dayOfWeek,
          is_dst: isDst
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error: any) {
        throw new Error(`Time API error: ${error.message}`);
      }
    } else if (name === 'convert_time') {
      const sourceTimezone = toolArgs?.source_timezone || '';
      const timeStr = toolArgs?.time || '';
      const targetTimezone = toolArgs?.target_timezone || '';
      
      try {
        this.validateTimezone(sourceTimezone);
        this.validateTimezone(targetTimezone);
        
        // Parse time string (HH:MM format)
        const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
        if (!timeMatch) {
          throw new Error('Invalid time format. Expected HH:MM [24-hour format]');
        }
        
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
          throw new Error('Invalid time. Hours must be 0-23, minutes must be 0-59');
        }
        
        // Create date in source timezone for today
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const day = now.getDate();
        
        // Create source time
        const sourceDate = new Date(year, month, day, hours, minutes, 0);
        
        // Get timezone offsets
        const sourceOffset = this.getTimezoneOffset(sourceDate, sourceTimezone);
        const targetOffset = this.getTimezoneOffset(sourceDate, targetTimezone);
        
        // Calculate target time
        const utcTime = sourceDate.getTime() - sourceOffset;
        const targetTime = new Date(utcTime + targetOffset);
        
        // Format results
        const sourceResult: TimeResult = {
          timezone: sourceTimezone,
          datetime: this.formatDateTime(sourceDate, sourceTimezone),
          day_of_week: this.getDayOfWeek(sourceDate, sourceTimezone),
          is_dst: this.isDST(sourceDate, sourceTimezone)
        };
        
        const targetResult: TimeResult = {
          timezone: targetTimezone,
          datetime: this.formatDateTime(targetTime, targetTimezone),
          day_of_week: this.getDayOfWeek(targetTime, targetTimezone),
          is_dst: this.isDST(targetTime, targetTimezone)
        };
        
        // Calculate time difference
        const diffHours = (targetOffset - sourceOffset) / (1000 * 60 * 60);
        const timeDifference = diffHours >= 0 ? `+${diffHours}h` : `${diffHours}h`;
        
        const result: TimeConversionResult = {
          source: sourceResult,
          target: targetResult,
          time_difference: timeDifference
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error: any) {
        throw new Error(`Time conversion error: ${error.message}`);
      }
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  }

  private getTimezoneOffset(date: Date, timezone: string): number {
    const utc1 = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const utc2 = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    return utc2.getTime() - utc1.getTime();
  }

  private formatDateTime(date: Date, timezone: string): string {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
    
    return formatted.replace(/(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6');
  }

  private getDayOfWeek(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      weekday: 'long'
    }).format(date);
  }
}

export const mcpTimeServer = functions
  .runWith({ timeoutSeconds: FUNCTION_CONSTANTS.TIMEOUTS.MCP_WEATHER_SERVER, memory: FUNCTION_CONSTANTS.MEMORY.SMALL })
  .https.onRequest(async (req, res) => {
    // Set CORS headers
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    console.log(`MCP Time Server: ${req.method} ${req.url}`);

    const handler = new TimeMCPHandler();
    
    try {
      // Handle MCP protocol initialization
      if (req.method === 'POST' && req.url === '/initialize') {
        const initResponse = {
          jsonrpc: '2.0',
          id: req.body?.id || 1,
          result: await handler.handleInitialize()
        };

        res.json(initResponse);
        return;
      }

      // Handle tools list request
      if (req.method === 'POST' && req.url === '/tools/list') {
        const toolsResponse = {
          jsonrpc: '2.0',
          id: req.body?.id || 1,
          result: await handler.handleToolsList()
        };

        res.json(toolsResponse);
        return;
      }

      // Handle tool execution
      if (req.method === 'POST' && req.url === '/tools/call') {
        const { id, params } = req.body || {};
        
        try {
          const result = await handler.handleToolCall(params);
          
          const callResponse = {
            jsonrpc: '2.0',
            id: id || 1,
            result
          };

          res.json(callResponse);
          return;
        } catch (toolError: any) {
          console.error('Tool call error:', toolError);
          const errorResponse = {
            jsonrpc: '2.0',
            id: id || 1,
            error: {
              code: -32603,
              message: toolError.message || 'Tool execution failed'
            }
          };
          res.json(errorResponse);
          return;
        }
      }

      // Server info endpoint
      if (req.method === 'GET') {
        res.json({
          name: 'MCP Time Server',
          version: '1.0.0',
          protocol: 'MCP/2024-11-05',
          capabilities: ['tools'],
          endpoints: {
            initialize: 'POST /initialize',
            tools_list: 'POST /tools/list',
            tools_call: 'POST /tools/call'
          }
        });
        return;
      }

      // Method not supported
      res.status(405).json({ error: 'Method not allowed' });

    } catch (error: any) {
      console.error('Error in MCP Time Server:', error);
      
      const errorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        }
      };

      res.json(errorResponse);
    }
  });