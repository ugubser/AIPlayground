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

interface ConversionResult {
  original_value: number;
  original_unit: string;
  converted_value: number;
  converted_unit: string;
  conversion_type: string;
}


interface BatchConversionResult {
  request_id: string;
  success: boolean;
  original_value?: number;
  original_unit?: string;
  converted_value?: number;
  converted_unit?: string;
  conversion_type?: string;
  error?: string;
}

class UnitConverterMCPHandler {
  // Temperature conversion
  private convertTemperature(value: number, fromUnit: string, toUnit: string): number {
    const toCelsius = {
      fahrenheit: (v: number) => (v - 32) * 5 / 9,
      kelvin: (v: number) => v - 273.15,
      celsius: (v: number) => v,
    };

    const fromCelsius = {
      fahrenheit: (v: number) => v * 9 / 5 + 32,
      kelvin: (v: number) => v + 273.15,
      celsius: (v: number) => v,
    };

    const celsius = toCelsius[fromUnit as keyof typeof toCelsius](value);
    return fromCelsius[toUnit as keyof typeof fromCelsius](celsius);
  }

  // Length conversion
  private convertLength(value: number, fromUnit: string, toUnit: string): number {
    const toMeters: Record<string, number> = {
      'angstrom': 1e-10,
      'astronomical unit': 149_598_550_000.0,
      'cable': 182.88,
      'centimeter': 0.01,
      'chain (surveyors)': 20.11684023368,
      'decimeter': 0.1,
      'em (pica)': 0.0042333,
      'fathom': 1.8288,
      'foot': 0.3048,
      'foot (US survey)': 0.304800609601,
      'furlong': 201.168,
      'hand': 0.1016,
      'hectometer': 100.0,
      'inch': 0.0254,
      'kilometer': 1000.0,
      'light year': 9_460_528_405_000_000.0,
      'meter': 1.0,
      'micrometer': 1e-06,
      'mil': 2.54e-05,
      'mile': 1609.344,
      'nautical mile': 1852.0,
      'nautical mile (UK)': 1853.184,
      'millimeter': 0.001,
      'nanometer': 1e-09,
      'parsec': 30_856_776_000_000_000.0,
      'picometer': 1e-12,
      'Scandinavian mile': 10_000.0,
      'thou': 2.54e-05,
      'yard': 0.9144,
    };

    const meters = value * toMeters[fromUnit];
    return meters / toMeters[toUnit];
  }

  // Mass conversion
  private convertMass(value: number, fromUnit: string, toUnit: string): number {
    const toKilograms: Record<string, number> = {
      'caret': 0.0002,
      'decagram': 0.01,
      'hectogram': 0.1,
      'gram': 0.001,
      'milligram': 1e-6,
      'microgram': 1e-9,
      'nanogram': 1e-12,
      'picogram': 1e-15,
      'femtogram': 1e-18,
      'grain': 6.479891e-05,
      'ounce': 0.028349523125,
      'troy ounce': 0.0311034768,
      'pound': 0.45359237,
      'stone': 6.35029318,
      'short ton (US)': 907.18474,
      'long ton (UK)': 1_016.0469088,
      'tonne': 1_000.0,
      'kilotonne': 1_000_000.0,
      'megatonne': 1_000_000_000.0,
      'kilogram': 1.0,
    };

    const kg = value * toKilograms[fromUnit];
    return kg / toKilograms[toUnit];
  }

  // Volume conversion
  private convertVolume(value: number, fromUnit: string, toUnit: string): number {
    const toLiters: Record<string, number> = {
      'acre foot': 1233481.83754752,
      'barrel (oil)': 158.987294928,
      'bushel (UK)': 36.36872,
      'bushel (US)': 35.23907016688,
      'bushel': 35.23907016688,
      'centiliter': 0.01,
      'cubic centimeter': 0.001,
      'cubic decimeter': 1.0,
      'cubic foot': 28.316846592,
      'cubic inch': 0.016387064,
      'cubic kilometer': 1_000_000_000_000.0,
      'cubic meter': 1000.0,
      'cubic mile': 4_168_181_825_000.0,
      'cubic millimeter': 1e-06,
      'cubic yard': 764.554857984,
      'cup': 0.2365882365,
      'deciliter': 0.1,
      'fluid ounce (imperial)': 0.0284130625,
      'fluid ounce (US)': 0.029573529562,
      'fluid ounce': 0.029573529562,
      'gallon (imperial)': 4.54609,
      'gallon (US)': 3.785411784,
      'gallon': 3.785411784,
      'kiloliter': 1000.0,
      'liter': 1.0,
      'milliliter': 0.001,
      'microliter': 1e-06,
      'nanoliter': 1e-09,
      'picoliter': 1e-12,
      'pint (imperial)': 0.56826125,
      'pint (US)': 0.473176473,
      'pint': 0.473176473,
      'quart (imperial)': 1.1365225,
      'quart (US)': 0.946352946,
      'quart': 0.946352946,
      'tablespoon': 0.014786764781,
      'teaspoon': 0.004928921594,
    };

    const liters = value * toLiters[fromUnit];
    return liters / toLiters[toUnit];
  }

  // Computer data conversion
  private convertComputerData(value: number, fromUnit: string, toUnit: string): number {
    const toMegabytes: Record<string, number> = {
      'bits': 1.19209e-07,
      'bytes': 9.53674e-07,
      'kilobytes': 0.0009765625,
      'megabytes': 1.0,
      'gigabytes': 1024.0,
      'terabytes': 1048576.0,
      'petabytes': 1073741824.0,
      'exabytes': 1099511627776.0,
    };

    const megabytes = value * toMegabytes[fromUnit];
    return megabytes / toMegabytes[toUnit];
  }

  // Get conversion function by type
  private getConversionFunction(conversionType: string): ((value: number, fromUnit: string, toUnit: string) => number) | null {
    const conversionFunctions: Record<string, (value: number, fromUnit: string, toUnit: string) => number> = {
      temperature: this.convertTemperature.bind(this),
      length: this.convertLength.bind(this),
      mass: this.convertMass.bind(this),
      volume: this.convertVolume.bind(this),
      computer_data: this.convertComputerData.bind(this),
    };

    return conversionFunctions[conversionType] || null;
  }

  // Get supported units for each type
  private getSupportedUnits(): Record<string, string[]> {
    return {
      temperature: ['celsius', 'fahrenheit', 'kelvin'],
      length: [
        'angstrom', 'astronomical unit', 'cable', 'centimeter', 'chain (surveyors)',
        'decimeter', 'em (pica)', 'fathom', 'foot', 'foot (US survey)', 'furlong',
        'hand', 'hectometer', 'inch', 'kilometer', 'light year', 'meter',
        'micrometer', 'mil', 'mile', 'nautical mile', 'nautical mile (UK)',
        'millimeter', 'nanometer', 'parsec', 'picometer', 'Scandinavian mile',
        'thou', 'yard'
      ],
      mass: [
        'carat', 'decagram', 'hectogram', 'gram', 'milligram', 'microgram',
        'nanogram', 'picogram', 'femtogram', 'grain', 'ounce', 'troy ounce',
        'pound', 'stone', 'short ton (US)', 'long ton (UK)', 'tonne',
        'kilotonne', 'megatonne', 'kilogram'
      ],
      volume: [
        'acre foot', 'barrel (oil)', 'bushel (UK)', 'bushel (US)', 'bushel',
        'centiliter', 'cubic centimeter', 'cubic decimeter', 'cubic foot',
        'cubic inch', 'cubic kilometer', 'cubic meter', 'cubic mile',
        'cubic millimeter', 'cubic yard', 'cup', 'deciliter',
        'fluid ounce (imperial)', 'fluid ounce (US)', 'fluid ounce',
        'gallon (imperial)', 'gallon (US)', 'gallon', 'kiloliter', 'liter',
        'milliliter', 'microliter', 'nanoliter', 'picoliter',
        'pint (imperial)', 'pint (US)', 'pint', 'quart (imperial)',
        'quart (US)', 'quart', 'tablespoon', 'teaspoon'
      ],
      computer_data: [
        'bits', 'bytes', 'kilobytes', 'megabytes', 'gigabytes',
        'terabytes', 'petabytes', 'exabytes'
      ]
    };
  }

  async handleInitialize(): Promise<any> {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'unit-converter-server',
        version: '1.0.0'
      }
    };
  }

  async handleToolsList(): Promise<{ tools: MCPTool[] }> {
    const supportedUnits = this.getSupportedUnits();
    
    const tools: MCPTool[] = [
      {
        name: 'convert_temperature',
        description: 'Convert temperature between units',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Temperature value to convert' },
            from_unit: { type: 'string', enum: supportedUnits.temperature, description: 'Source unit' },
            to_unit: { type: 'string', enum: supportedUnits.temperature, description: 'Target unit' }
          },
          required: ['value', 'from_unit', 'to_unit']
        }
      },
      {
        name: 'convert_length',
        description: 'Convert length between units',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Length value to convert' },
            from_unit: { type: 'string', enum: supportedUnits.length, description: 'Source unit' },
            to_unit: { type: 'string', enum: supportedUnits.length, description: 'Target unit' }
          },
          required: ['value', 'from_unit', 'to_unit']
        }
      },
      {
        name: 'convert_mass',
        description: 'Convert mass/weight between units',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Mass value to convert' },
            from_unit: { type: 'string', enum: supportedUnits.mass, description: 'Source unit' },
            to_unit: { type: 'string', enum: supportedUnits.mass, description: 'Target unit' }
          },
          required: ['value', 'from_unit', 'to_unit']
        }
      },
      {
        name: 'convert_volume',
        description: 'Convert volume between units',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Volume value to convert' },
            from_unit: { type: 'string', enum: supportedUnits.volume, description: 'Source unit' },
            to_unit: { type: 'string', enum: supportedUnits.volume, description: 'Target unit' }
          },
          required: ['value', 'from_unit', 'to_unit']
        }
      },
      {
        name: 'convert_computer_data',
        description: 'Convert computer storage between units',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Storage value to convert' },
            from_unit: { type: 'string', enum: supportedUnits.computer_data, description: 'Source unit' },
            to_unit: { type: 'string', enum: supportedUnits.computer_data, description: 'Target unit' }
          },
          required: ['value', 'from_unit', 'to_unit']
        }
      },
      {
        name: 'convert_batch',
        description: 'Perform multiple unit conversions in a single batch request',
        inputSchema: {
          type: 'object',
          properties: {
            requests: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  value: { type: 'number', description: 'Value to convert' },
                  from_unit: { type: 'string', description: 'Source unit' },
                  to_unit: { type: 'string', description: 'Target unit' },
                  conversion_type: { 
                    type: 'string', 
                    enum: ['temperature', 'length', 'mass', 'volume', 'computer_data'],
                    description: 'Type of conversion' 
                  },
                  request_id: { type: 'string', description: 'Optional identifier for tracking' }
                },
                required: ['value', 'from_unit', 'to_unit', 'conversion_type']
              },
              description: 'List of conversion requests'
            }
          },
          required: ['requests']
        }
      },
      {
        name: 'list_supported_units',
        description: 'List all supported units for each conversion type or for a specific type',
        inputSchema: {
          type: 'object',
          properties: {
            unit_type: {
              type: 'string',
              enum: ['temperature', 'length', 'mass', 'volume', 'computer_data'],
              description: 'Specific unit type to get supported units for. If not specified, returns all supported units.'
            }
          },
          required: []
        }
      }
    ];

    return { tools };
  }

  async handleToolCall(params: any): Promise<any> {
    const { name, arguments: toolArgs } = params || {};

    try {
      if (name === 'convert_temperature') {
        const { value, from_unit, to_unit } = toolArgs;
        const convertedValue = this.convertTemperature(value, from_unit, to_unit);
        
        const result: ConversionResult = {
          original_value: value,
          original_unit: from_unit,
          converted_value: convertedValue,
          converted_unit: to_unit,
          conversion_type: 'temperature'
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      if (name === 'convert_length') {
        const { value, from_unit, to_unit } = toolArgs;
        const convertedValue = this.convertLength(value, from_unit, to_unit);
        
        const result: ConversionResult = {
          original_value: value,
          original_unit: from_unit,
          converted_value: convertedValue,
          converted_unit: to_unit,
          conversion_type: 'length'
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      if (name === 'convert_mass') {
        const { value, from_unit, to_unit } = toolArgs;
        const convertedValue = this.convertMass(value, from_unit, to_unit);
        
        const result: ConversionResult = {
          original_value: value,
          original_unit: from_unit,
          converted_value: convertedValue,
          converted_unit: to_unit,
          conversion_type: 'mass'
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      if (name === 'convert_volume') {
        const { value, from_unit, to_unit } = toolArgs;
        const convertedValue = this.convertVolume(value, from_unit, to_unit);
        
        const result: ConversionResult = {
          original_value: value,
          original_unit: from_unit,
          converted_value: convertedValue,
          converted_unit: to_unit,
          conversion_type: 'volume'
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      if (name === 'convert_computer_data') {
        const { value, from_unit, to_unit } = toolArgs;
        const convertedValue = this.convertComputerData(value, from_unit, to_unit);
        
        const result: ConversionResult = {
          original_value: value,
          original_unit: from_unit,
          converted_value: convertedValue,
          converted_unit: to_unit,
          conversion_type: 'computer_data'
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      if (name === 'convert_batch') {
        const { requests } = toolArgs;
        const results: BatchConversionResult[] = [];

        for (const request of requests) {
          try {
            const { value, from_unit, to_unit, conversion_type, request_id } = request;
            const conversionFunction = this.getConversionFunction(conversion_type);
            
            if (!conversionFunction) {
              throw new Error(`Unsupported conversion type: ${conversion_type}`);
            }

            const convertedValue = conversionFunction(value, from_unit, to_unit);
            
            results.push({
              request_id: request_id || `${conversion_type}_${results.length}`,
              success: true,
              original_value: value,
              original_unit: from_unit,
              converted_value: convertedValue,
              converted_unit: to_unit,
              conversion_type
            });
          } catch (error: any) {
            results.push({
              request_id: request.request_id || `error_${results.length}`,
              success: false,
              error: error.message
            });
          }
        }

        const successful = results.filter(r => r.success).length;
        const batchResult = {
          batch_results: results,
          summary: {
            total_requests: requests.length,
            successful_conversions: successful,
            failed_conversions: requests.length - successful
          }
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(batchResult, null, 2) }]
        };
      }

      if (name === 'list_supported_units') {
        const { unit_type } = toolArgs || {};
        const allUnits = this.getSupportedUnits();

        if (unit_type) {
          const result = { [unit_type]: allUnits[unit_type] || [] };
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(allUnits, null, 2) }]
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error: any) {
      throw new Error(`Unit conversion error: ${error.message}`);
    }
  }
}

export const mcpUnitConverterServer = functions
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

    console.log(`MCP Unit Converter Server: ${req.method} ${req.url}`);

    const handler = new UnitConverterMCPHandler();
    
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
          name: 'MCP Unit Converter Server',
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
      console.error('Error in MCP Unit Converter Server:', error);
      
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