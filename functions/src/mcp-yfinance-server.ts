import * as functions from 'firebase-functions';
import yahooFinance from 'yahoo-finance2';
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

class YFinanceMCPHandler {
  async handleInitialize(): Promise<any> {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'yfinance-server',
        version: '1.0.0'
      }
    };
  }

  async handleToolsList(): Promise<{ tools: MCPTool[] }> {
    return {
      tools: [
        {
          name: 'get_stock_metric',
          description: `Get a specific metric for a stock using yfinance field names.
          Common requests and their exact field names:
          
          Stock Price & Trading Info:
          - Current/Stock Price: currentPrice
          - Opening Price: open
          - Day's High: dayHigh
          - Day's Low: dayLow
          - Previous Close: previousClose
          - 52 Week High: fiftyTwoWeekHigh
          - 52 Week Low: fiftyTwoWeekLow
          - 50 Day Average: fiftyDayAverage
          - 200 Day Average: twoHundredDayAverage
          - Trading Volume: volume
          - Average Volume: averageVolume
          - Average Daily Volume (10 day): averageDailyVolume10Day
          - Market Cap/Capitalization: marketCap
          - Beta: beta
          - Bid Price: bid
          - Ask Price: ask
          - Bid Size: bidSize
          - Ask Size: askSize
          
          Company Information:
          - Company Name: longName
          - Short Name: shortName
          - Business Description/About/Summary: longBusinessSummary
          - Industry: industry
          - Sector: sector
          - Website: website
          - Number of Employees: fullTimeEmployees
          - Country: country
          - State: state
          - City: city
          - Address: address1
          
          Financial Metrics:
          - PE Ratio: trailingPE
          - Forward PE: forwardPE
          - Price to Book: priceToBook
          - Price to Sales: priceToSalesTrailing12Months
          - Enterprise Value: enterpriseValue
          - Enterprise to EBITDA: enterpriseToEbitda
          - Enterprise to Revenue: enterpriseToRevenue
          - Book Value: bookValue
          
          Earnings & Revenue:
          - Revenue/Total Revenue: totalRevenue
          - Revenue Growth: revenueGrowth
          - Revenue Per Share: revenuePerShare
          - EBITDA: ebitda
          - EBITDA Margins: ebitdaMargins
          - Net Income: netIncomeToCommon
          - Earnings Growth: earningsGrowth
          - Quarterly Earnings Growth: earningsQuarterlyGrowth
          - Forward EPS: forwardEps
          - Trailing EPS: trailingEps
          
          Margins & Returns:
          - Profit Margin: profitMargins
          - Operating Margin: operatingMargins
          - Gross Margins: grossMargins
          - Return on Equity/ROE: returnOnEquity
          - Return on Assets/ROA: returnOnAssets
          
          Dividends:
          - Dividend Yield: dividendYield
          - Dividend Rate: dividendRate
          - Dividend Date: lastDividendDate
          - Ex-Dividend Date: exDividendDate
          - Payout Ratio: payoutRatio
          
          Balance Sheet:
          - Total Cash: totalCash
          - Cash Per Share: totalCashPerShare
          - Total Debt: totalDebt
          - Debt to Equity: debtToEquity
          - Current Ratio: currentRatio
          - Quick Ratio: quickRatio
          
          Ownership:
          - Institutional Ownership: heldPercentInstitutions
          - Insider Ownership: heldPercentInsiders
          - Float Shares: floatShares
          - Shares Outstanding: sharesOutstanding
          - Short Ratio: shortRatio
          
          Analyst Coverage:
          - Analyst Recommendation: recommendationKey
          - Number of Analysts: numberOfAnalystOpinions
          - Price Target Mean: targetMeanPrice
          - Price Target High: targetHighPrice
          - Price Target Low: targetLowPrice
          - Price Target Median: targetMedianPrice
          
          Risk Metrics:
          - Overall Risk: overallRisk
          - Audit Risk: auditRisk
          - Board Risk: boardRisk
          - Compensation Risk: compensationRisk
          
          Other:
          - Currency: currency
          - Exchange: exchange
          - Year Change/52 Week Change: 52WeekChange
          - S&P 500 Year Change: SandP52WeekChange`,
          inputSchema: {
            type: 'object',
            properties: {
              symbol: {
                type: 'string',
                description: 'Stock symbol'
              },
              metric: {
                type: 'string',
                description: 'The metric to retrieve, use camelCase'
              }
            },
            required: ['symbol', 'metric']
          }
        },
        {
          name: 'get_historical_data',
          description: 'Get historical stock data for a symbol',
          inputSchema: {
            type: 'object',
            properties: {
              symbol: {
                type: 'string',
                description: 'Stock symbol'
              },
              period: {
                type: 'string',
                description: 'Time period (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max)',
                enum: ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']
              }
            },
            required: ['symbol', 'period']
          }
        }
      ]
    };
  }

  async handleToolCall(params: any): Promise<any> {
    const { name, arguments: toolArgs } = params || {};

    if (name === 'get_stock_metric') {
      const symbol = toolArgs?.symbol || '';
      const metric = toolArgs?.metric || '';
      
      try {
        const stockInfo = await yahooFinance.quoteSummary(symbol, { modules: ['summaryDetail', 'financialData', 'defaultKeyStatistics', 'assetProfile'] });
        
        // Flatten the data structure to match Python yfinance format
        const flatData: any = {};
        if (stockInfo.summaryDetail) Object.assign(flatData, stockInfo.summaryDetail);
        if (stockInfo.financialData) Object.assign(flatData, stockInfo.financialData);
        if (stockInfo.defaultKeyStatistics) Object.assign(flatData, stockInfo.defaultKeyStatistics);
        if (stockInfo.assetProfile) Object.assign(flatData, stockInfo.assetProfile);

        if (metric in flatData) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ [metric]: flatData[metric] }, null, 2)
              }
            ]
          };
        } else {
          throw new Error(`Metric ${metric} not found`);
        }
      } catch (error: any) {
        throw new Error(`Stock API error: ${error.message}`);
      }
    } else if (name === 'get_historical_data') {
      const symbol = toolArgs?.symbol || '';
      const period = toolArgs?.period || '1mo';
      
      try {
        const historicalData = await yahooFinance.historical(symbol, {
          period1: this.getPeriodStartDate(period),
          interval: '1d'
        });
        
        const formattedData = historicalData.map(row => ({
          date: row.date.toISOString().split('T')[0],
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formattedData, null, 2)
            }
          ]
        };
      } catch (error: any) {
        throw new Error(`Stock API error: ${error.message}`);
      }
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  }

  private getPeriodStartDate(period: string): Date {
    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    
    switch (period) {
      case '1d': return new Date(now.getTime() - 1 * msPerDay);
      case '5d': return new Date(now.getTime() - 5 * msPerDay);
      case '1mo': return new Date(now.getTime() - 30 * msPerDay);
      case '3mo': return new Date(now.getTime() - 90 * msPerDay);
      case '6mo': return new Date(now.getTime() - 180 * msPerDay);
      case '1y': return new Date(now.getTime() - 365 * msPerDay);
      case '2y': return new Date(now.getTime() - 2 * 365 * msPerDay);
      case '5y': return new Date(now.getTime() - 5 * 365 * msPerDay);
      case '10y': return new Date(now.getTime() - 10 * 365 * msPerDay);
      case 'ytd': {
        const yearStart = new Date(now.getFullYear(), 0, 1);
        return yearStart;
      }
      case 'max': return new Date('1970-01-01');
      default: return new Date(now.getTime() - 30 * msPerDay);
    }
  }
}

export const mcpYFinanceServer = functions
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

    console.log(`MCP YFinance Server: ${req.method} ${req.url}`);

    const handler = new YFinanceMCPHandler();
    
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
          name: 'MCP YFinance Server',
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
      console.error('Error in MCP YFinance Server:', error);
      
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