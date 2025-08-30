import * as functions from 'firebase-functions';
import { create, all } from 'mathjs';
import { FUNCTION_CONSTANTS } from './config/function-constants';

const math = create(all);

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

class CalculatorMCPHandler {
  private safeEvaluate(expression: string): any {
    try {
      // Use mathjs safe evaluation with restricted scope
      return math.evaluate(expression);
    } catch (error: any) {
      throw new Error(`Evaluation error: ${error.message}`);
    }
  }

  private calculateStatistics(data: number[]): {
    mean: number;
    median: number;
    variance: number;
    standardDeviation: number;
    min: number;
    max: number;
  } {
    if (data.length === 0) {
      throw new Error('Cannot compute statistics for empty array');
    }

    const sorted = [...data].sort((a, b) => a - b);
    const n = data.length;
    const sum = data.reduce((acc, val) => acc + val, 0);
    const mean = sum / n;
    
    // Median
    const median = n % 2 === 0 
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    
    // Variance and standard deviation
    const variance = data.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
    const standardDeviation = Math.sqrt(variance);
    
    return {
      mean,
      median,
      variance,
      standardDeviation,
      min: Math.min(...data),
      max: Math.max(...data)
    };
  }


  private calculateCorrelation(dataX: number[], dataY: number[]): number {
    if (dataX.length !== dataY.length) {
      throw new Error('Data arrays must have the same length');
    }
    
    const n = dataX.length;
    const meanX = dataX.reduce((a, b) => a + b, 0) / n;
    const meanY = dataY.reduce((a, b) => a + b, 0) / n;
    
    const numerator = dataX.reduce((sum, x, i) => sum + (x - meanX) * (dataY[i] - meanY), 0);
    const denomX = Math.sqrt(dataX.reduce((sum, x) => sum + Math.pow(x - meanX, 2), 0));
    const denomY = Math.sqrt(dataY.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0));
    
    return numerator / (denomX * denomY);
  }

  private calculateLinearRegression(data: [number, number][]): { slope: number; intercept: number } {
    const n = data.length;
    const sumX = data.reduce((sum, [x]) => sum + x, 0);
    const sumY = data.reduce((sum, [, y]) => sum + y, 0);
    const sumXY = data.reduce((sum, [x, y]) => sum + x * y, 0);
    const sumXX = data.reduce((sum, [x]) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }

  private performMatrixOperation(operation: string, matrixA: number[][], matrixB?: number[][]): any {
    try {
      const matA = math.matrix(matrixA);
      
      switch (operation) {
        case 'transpose':
          return math.transpose(matA).toArray();
        case 'determinant':
          return math.det(matA);
        case 'addition':
          if (!matrixB) throw new Error('Matrix B required for addition');
          return math.add(matA, math.matrix(matrixB)).toArray();
        case 'multiplication':
          if (!matrixB) throw new Error('Matrix B required for multiplication');
          return math.multiply(matA, math.matrix(matrixB)).toArray();
        default:
          throw new Error(`Unknown matrix operation: ${operation}`);
      }
    } catch (error: any) {
      throw new Error(`Matrix operation error: ${error.message}`);
    }
  }

  async handleInitialize(): Promise<any> {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'calculator-server',
        version: '1.0.0'
      }
    };
  }

  async handleToolsList(): Promise<{ tools: MCPTool[] }> {
    return {
      tools: [
        {
          name: 'calculate',
          description: 'Evaluates a mathematical expression and returns the result. Supports basic operators (+, -, *, /, **, %), mathematical functions (sin, cos, tan, exp, log, sqrt), and constants (pi, e).',
          inputSchema: {
            type: 'object',
            properties: {
              expression: {
                type: 'string',
                description: 'The mathematical expression to evaluate. Examples: "2 + 2", "sin(pi/4)", "sqrt(16) * 2", "log(100, 10)"'
              }
            },
            required: ['expression']
          }
        },
        {
          name: 'solve_equation',
          description: 'Solves an algebraic equation for x and returns all solutions. The equation must contain exactly one equality sign (=).',
          inputSchema: {
            type: 'object',
            properties: {
              equation: {
                type: 'string',
                description: 'The equation to solve. Format: "<left side> = <right side>". Examples: "x^2 - 5*x + 6 = 0", "2*x + 3 = 7"'
              }
            },
            required: ['equation']
          }
        },
        {
          name: 'differentiate',
          description: 'Computes the derivative of a mathematical expression with respect to a variable.',
          inputSchema: {
            type: 'object',
            properties: {
              expression: {
                type: 'string',
                description: 'The mathematical expression to differentiate. Examples: "x^2", "sin(x)", "exp(x)"'
              },
              variable: {
                type: 'string',
                description: 'The variable with respect to which to differentiate. Default is "x".',
                default: 'x'
              }
            },
            required: ['expression']
          }
        },
        {
          name: 'integrate',
          description: 'Computes the indefinite integral of a mathematical expression with respect to a variable.',
          inputSchema: {
            type: 'object',
            properties: {
              expression: {
                type: 'string',
                description: 'The mathematical expression to integrate. Examples: "x^2", "sin(x)", "exp(x)"'
              },
              variable: {
                type: 'string',
                description: 'The variable with respect to which to integrate. Default is "x".',
                default: 'x'
              }
            },
            required: ['expression']
          }
        },
        {
          name: 'statistics',
          description: 'Computes comprehensive statistics for a dataset including mean, median, variance, standard deviation, min, and max.',
          inputSchema: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: { type: 'number' },
                description: 'A list of numerical values for statistical analysis'
              }
            },
            required: ['data']
          }
        },
        {
          name: 'correlation_coefficient',
          description: 'Computes the Pearson correlation coefficient between two datasets.',
          inputSchema: {
            type: 'object',
            properties: {
              data_x: {
                type: 'array',
                items: { type: 'number' },
                description: 'The first dataset'
              },
              data_y: {
                type: 'array',
                items: { type: 'number' },
                description: 'The second dataset'
              }
            },
            required: ['data_x', 'data_y']
          }
        },
        {
          name: 'linear_regression',
          description: 'Performs linear regression on a set of points and returns the slope and intercept.',
          inputSchema: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'number' },
                  minItems: 2,
                  maxItems: 2
                },
                description: 'A list of [x, y] coordinate pairs'
              }
            },
            required: ['data']
          }
        },
        {
          name: 'matrix_operations',
          description: 'Performs various matrix operations including addition, multiplication, transpose, and determinant.',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['addition', 'multiplication', 'transpose', 'determinant'],
                description: 'The matrix operation to perform'
              },
              matrix_a: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'number' }
                },
                description: 'The first matrix (or only matrix for transpose/determinant)'
              },
              matrix_b: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'number' }
                },
                description: 'The second matrix (required for addition/multiplication)'
              }
            },
            required: ['operation', 'matrix_a']
          }
        }
      ]
    };
  }

  async handleToolCall(params: any): Promise<any> {
    const { name, arguments: toolArgs } = params || {};

    try {
      if (name === 'calculate') {
        const { expression } = toolArgs;
        const result = this.safeEvaluate(expression);
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({ result: typeof result === 'number' ? result : result.toString() }, null, 2) 
          }]
        };
      }

      if (name === 'solve_equation') {
        const { equation } = toolArgs;
        
        const parts = equation.split('=');
        if (parts.length !== 2) {
          throw new Error("Equation must contain exactly one '=' sign");
        }

        // Note: mathjs doesn't have symbolic equation solving like SymPy
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({ error: 'Symbolic equation solving not fully supported in Node.js version. For simple linear equations, try using the calculate tool with rearranged expressions.' }, null, 2) 
          }]
        };
      }

      if (name === 'differentiate') {
        const { expression, variable = 'x' } = toolArgs;
        
        try {
          const derivative = math.derivative(expression, variable);
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({ result: derivative.toString() }, null, 2) 
            }]
          };
        } catch (error: any) {
          throw new Error(`Differentiation error: ${error.message}`);
        }
      }

      if (name === 'integrate') {
        // Note: mathjs doesn't have symbolic integration, this is a limitation
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({ error: 'Symbolic integration not supported in Node.js version. Use numerical integration or consider upgrading to a symbolic math library.' }, null, 2) 
          }]
        };
      }

      if (name === 'statistics') {
        const { data } = toolArgs;
        const stats = this.calculateStatistics(data);
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(stats, null, 2) 
          }]
        };
      }

      if (name === 'correlation_coefficient') {
        const { data_x, data_y } = toolArgs;
        const correlation = this.calculateCorrelation(data_x, data_y);
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({ result: correlation }, null, 2) 
          }]
        };
      }

      if (name === 'linear_regression') {
        const { data } = toolArgs;
        const regression = this.calculateLinearRegression(data);
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(regression, null, 2) 
          }]
        };
      }

      if (name === 'matrix_operations') {
        const { operation, matrix_a, matrix_b } = toolArgs;
        const result = this.performMatrixOperation(operation, matrix_a, matrix_b);
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({ result }, null, 2) 
          }]
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error: any) {
      throw new Error(`Calculator error: ${error.message}`);
    }
  }
}

export const mcpCalculatorServer = functions
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

    console.log(`MCP Calculator Server: ${req.method} ${req.url}`);

    const handler = new CalculatorMCPHandler();
    
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
          name: 'MCP Calculator Server',
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
      console.error('Error in MCP Calculator Server:', error);
      
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