#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const readline = __importStar(require("readline"));
class MCPWeatherServer {
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
    handleMessage(line) {
        if (!line)
            return;
        try {
            const message = JSON.parse(line);
            this.processMessage(message);
        }
        catch (error) {
            process.stderr.write(`Error parsing message: ${error}\n`);
            this.sendError(undefined, -32700, 'Parse error');
        }
    }
    processMessage(message) {
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
    handleInitialize(id) {
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
    handleToolsList(id) {
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
    handleToolCall(id, params) {
        const { name, arguments: toolArgs } = params || {};
        if (name === 'get_weather') {
            const city = (toolArgs === null || toolArgs === void 0 ? void 0 : toolArgs.city) || '';
            let weather = 'Dim';
            if (city.toLowerCase().includes('new york')) {
                weather = 'Sunny';
            }
            else if (city.toLowerCase().includes('zurich')) {
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
        }
        else {
            this.sendError(id, -32601, `Unknown tool: ${name}`);
        }
    }
    sendResponse(id, result) {
        const response = {
            jsonrpc: '2.0',
            id: id || 1,
            result
        };
        console.log(JSON.stringify(response));
    }
    sendError(id, code, message, data) {
        const response = {
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
//# sourceMappingURL=mcp-weather-server.js.map