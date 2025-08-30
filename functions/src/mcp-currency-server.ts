import * as functions from 'firebase-functions';
import fetch from 'node-fetch';
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

interface ExchangeRateResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

interface CurrenciesResponse {
  [currencyCode: string]: string;
}

const FRANKFURTER_API_BASE = "https://api.frankfurter.dev/v1";

class CurrencyMCPHandler {
  async convertCurrency(from: string, to: string, amount: number): Promise<any> {
    try {
      const url = `${FRANKFURTER_API_BASE}/latest?base=${from.toUpperCase()}&symbols=${to.toUpperCase()}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Unable to fetch exchange rate. Status: ${response.status}`);
      }

      const data = await response.json() as ExchangeRateResponse;

      if (!data.rates || !data.rates[to.toUpperCase()]) {
        throw new Error(`Exchange rate not available for ${from.toUpperCase()} to ${to.toUpperCase()}`);
      }

      const rate = data.rates[to.toUpperCase()];
      const convertedAmount = Math.round(amount * rate * 100) / 100;

      return {
        ...data,
        conversion: {
          from: from.toUpperCase(),
          to: to.toUpperCase(),
          amount: amount,
          result: convertedAmount,
          rate: rate,
        },
      };
    } catch (error: any) {
      throw new Error(`Failed to convert currency: ${error.message}`);
    }
  }

  async getLatestRates(base?: string, symbols?: string): Promise<ExchangeRateResponse> {
    try {
      const params = new URLSearchParams();
      if (base) params.append("base", base.toUpperCase());
      if (symbols) params.append("symbols", symbols.toUpperCase());

      const url = `${FRANKFURTER_API_BASE}/latest${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Unable to fetch exchange rates. Status: ${response.status}`);
      }

      return await response.json() as ExchangeRateResponse;
    } catch (error: any) {
      throw new Error(`Failed to fetch exchange rates: ${error.message}`);
    }
  }

  async getCurrencies(): Promise<CurrenciesResponse> {
    try {
      const url = `${FRANKFURTER_API_BASE}/currencies`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Unable to fetch currencies. Status: ${response.status}`);
      }

      return await response.json() as CurrenciesResponse;
    } catch (error: any) {
      throw new Error(`Failed to fetch currencies: ${error.message}`);
    }
  }

  async getHistoricalRates(date: string, base?: string, symbols?: string): Promise<ExchangeRateResponse> {
    try {
      const params = new URLSearchParams();
      if (base) params.append("base", base.toUpperCase());
      if (symbols) params.append("symbols", symbols.toUpperCase());

      const url = `${FRANKFURTER_API_BASE}/${date}${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Unable to fetch historical rates. Status: ${response.status}`);
      }

      return await response.json() as ExchangeRateResponse;
    } catch (error: any) {
      throw new Error(`Failed to fetch historical rates: ${error.message}`);
    }
  }

  async handleInitialize(): Promise<any> {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'currency-converter-server',
        version: '1.0.0'
      }
    };
  }

  async handleToolsList(): Promise<{ tools: MCPTool[] }> {
    return {
      tools: [
        {
          name: 'convert_currency',
          description: 'Convert an amount from one currency to another using real-time exchange rates',
          inputSchema: {
            type: 'object',
            properties: {
              from: {
                type: 'string',
                minLength: 3,
                maxLength: 3,
                description: 'Source currency code (3 letters, e.g., "USD", "EUR")'
              },
              to: {
                type: 'string',
                minLength: 3,
                maxLength: 3,
                description: 'Target currency code (3 letters, e.g., "USD", "EUR")'
              },
              amount: {
                type: 'number',
                minimum: 0,
                description: 'Amount to convert (positive number)'
              }
            },
            required: ['from', 'to', 'amount']
          }
        },
        {
          name: 'get_latest_rates',
          description: 'Fetch the latest exchange rates for currencies',
          inputSchema: {
            type: 'object',
            properties: {
              base: {
                type: 'string',
                minLength: 3,
                maxLength: 3,
                description: 'Base currency code (default: EUR)'
              },
              symbols: {
                type: 'string',
                description: 'Comma-separated currency codes to limit results (e.g., "USD,GBP,JPY")'
              }
            },
            required: []
          }
        },
        {
          name: 'get_currencies',
          description: 'List all available currencies with their full names',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'get_historical_rates',
          description: 'Get historical exchange rates for a specific date',
          inputSchema: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                pattern: '^\\d{4}-\\d{2}-\\d{2}$',
                description: 'Date in YYYY-MM-DD format'
              },
              base: {
                type: 'string',
                minLength: 3,
                maxLength: 3,
                description: 'Base currency code (default: EUR)'
              },
              symbols: {
                type: 'string',
                description: 'Comma-separated currency codes to limit results'
              }
            },
            required: ['date']
          }
        }
      ]
    };
  }

  async handleToolCall(params: any): Promise<any> {
    const { name, arguments: toolArgs } = params || {};

    try {
      if (name === 'convert_currency') {
        const { from, to, amount } = toolArgs;
        const result = await this.convertCurrency(from, to, amount);
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result, null, 2) 
          }]
        };
      }

      if (name === 'get_latest_rates') {
        const { base, symbols } = toolArgs || {};
        const result = await this.getLatestRates(base, symbols);
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result, null, 2) 
          }]
        };
      }

      if (name === 'get_currencies') {
        const result = await this.getCurrencies();
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result, null, 2) 
          }]
        };
      }

      if (name === 'get_historical_rates') {
        const { date, base, symbols } = toolArgs;
        const result = await this.getHistoricalRates(date, base, symbols);
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result, null, 2) 
          }]
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error: any) {
      throw new Error(`Currency API error: ${error.message}`);
    }
  }
}

export const mcpCurrencyServer = functions
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

    console.log(`MCP Currency Server: ${req.method} ${req.url}`);

    const handler = new CurrencyMCPHandler();
    
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
          name: 'MCP Currency Server',
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
      console.error('Error in MCP Currency Server:', error);
      
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