import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getCorsHeaders, handleCorsPreflightRequest } from './utils/cors';
import { getLLMResponseWithTools } from './utils/llm-utils';
import { FUNCTION_CONSTANTS } from './config/function-constants';

const DEFAULT_MCP_MODEL = FUNCTION_CONSTANTS.DEFAULTS.MCP_MODEL;
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

interface ExecutorRequest {
  task: {
    id: string;
    description: string;
    tools: string[];
    dependencyResults: Record<string, any>;
  };
  modelSelection?: any;
  temperature?: number;
  seed?: number;
  enablePromptLogging?: boolean;
  preFilteredTools?: any[]; // Pre-filtered tools to avoid redundant server calls
}

interface MultiTaskExecutorRequest {
  tasks: Array<{
    id: string;
    description: string;
    tools: string[];
    dependencyResults: Record<string, any>;
  }>;
  modelSelection?: any;
  temperature?: number;
  seed?: number;
  enablePromptLogging?: boolean;
  preFilteredTools?: any[];
}

interface ExecutorResponse {
  taskId: string;
  result: any;
  reasoning: string;
  toolCalls: any[];
  success: boolean;
  promptData?: {
    llmRequest?: any;
    llmResponse?: any;
  };
  mcpPromptData?: any[];
}

interface MultiTaskExecutorResponse {
  taskResults: Record<string, any>;
  toolCalls: any[];
  success: boolean;
  promptData?: {
    llmRequest?: any;
    llmResponse?: any;
  };
  mcpPromptData?: any[];
}

export const multiAgentExecutor = onRequest(
  {
    timeoutSeconds: 540,
    memory: '2GiB',
    cors: true
  },
  async (req, res) => {
    try {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        handleCorsPreflightRequest(res);
        return;
      }

      // Set CORS headers
      const corsHeaders = getCorsHeaders();
      Object.keys(corsHeaders).forEach(key => {
        res.set(key, corsHeaders[key]);
      });

      if (req.method !== 'POST') {
        logger.warn('Invalid method for executor', { method: req.method });
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const { task, modelSelection, temperature, seed, enablePromptLogging = false, preFilteredTools }: ExecutorRequest = req.body;

      if (!task || !task.id || !task.description) {
        logger.warn('Missing required task fields', { 
          hasTask: !!task,
          hasId: !!task?.id,
          hasDescription: !!task?.description
        });
        res.status(400).json({ error: 'Task with id and description is required' });
        return;
      }

      // Determine which model to use
      let actualModel = DEFAULT_MCP_MODEL;
      if (modelSelection && modelSelection.llm) {
        actualModel = modelSelection.llm.model;
        logger.info('Using selected model for task execution', { 
          taskId: task.id,
          provider: modelSelection.llm.provider,
          model: actualModel
        });
      }

      logger.info('Executing task', { 
        taskId: task.id,
        description: task.description.substring(0, 100) + '...',
        toolCount: task.tools?.length || 0,
        dependencyCount: Object.keys(task.dependencyResults || {}).length,
        model: actualModel,
        temperature: temperature,
        seed: seed
      });

      if (isEmulator) {
        console.log('⚡ Multi-Agent Executor Request:', JSON.stringify({
          taskId: task.id,
          description: task.description,
          tools: task.tools,
          dependencyResults: task.dependencyResults,
          model: actualModel,
          temperature: temperature,
          seed: seed
        }, null, 2));
      }

      // Create the execution prompt
      const executionPrompt = createExecutionPrompt(task);

      if (isEmulator) {
        console.log('📝 Executor Prompt:', executionPrompt.substring(0, 1500) + '...');
      }

      // Use pre-filtered tools if provided, otherwise get available tools for this task
      let availableTools: any[];
      if (preFilteredTools !== undefined) {
        availableTools = preFilteredTools;
        logger.info('Using pre-filtered tools', { 
          taskId: task.id,
          requestedTools: task.tools,
          preFilteredCount: availableTools.length
        });
      } else {
        // Fallback to old method if pre-filtered tools not provided
        availableTools = await getAvailableToolsForTask(task.tools);
        logger.info('Tools available for task (fallback)', { 
          taskId: task.id,
          requestedTools: task.tools,
          availableToolsCount: availableTools.length
        });
      }

      if (isEmulator) {
        console.log('🔧 Available Tools for Task:', JSON.stringify({
          taskId: task.id,
          requestedTools: task.tools,
          usingPreFiltered: preFilteredTools !== undefined,
          availableTools: availableTools.map(t => ({
            name: t.function?.name || t.name,
            description: (t.function?.description || t.description)?.substring(0, 100) + '...'
          }))
        }, null, 2));
      }

      // Execute with tools if available
      let result;
      let toolCalls: any[] = [];
      let toolResponse: any = null;

      if (availableTools.length > 0) {
        if (isEmulator) {
          console.log('🛠️ Executing with tools...');
        }

        // Use tool-enabled execution
        toolResponse = await getLLMResponseWithTools([
          {
            role: 'system',
            content: EXECUTOR_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: executionPrompt
          }
        ], actualModel, availableTools, task.id, temperature, seed, enablePromptLogging);

        result = toolResponse.content;
        toolCalls = toolResponse.toolCalls || [];

        if (isEmulator) {
          console.log('🔧 Tool Execution Results:', JSON.stringify({
            taskId: task.id,
            resultLength: result.length,
            toolCallsCount: toolCalls.length,
            toolCalls: toolCalls.map(tc => ({
              toolCall: tc.toolCall?.function?.name,
              hasResult: !!tc.result,
              resultPreview: typeof tc.result === 'string' 
                ? tc.result.substring(0, 100) + '...'
                : JSON.stringify(tc.result).substring(0, 100) + '...'
            }))
          }, null, 2));
        }

      } else {
        if (isEmulator) {
          console.log('💭 Executing without tools (reasoning only)...');
        }
        
        // Use regular LLM execution without tools
        const { getLLMResponse } = await import('./utils/llm-utils');
        result = await getLLMResponse([
          {
            role: 'system',
            content: EXECUTOR_SYSTEM_PROMPT_NO_TOOLS
          },
          {
            role: 'user',
            content: executionPrompt
          }
        ], actualModel, temperature, seed);

        if (isEmulator) {
          console.log('💭 Reasoning Result:', result.substring(0, 500) + '...');
        }
      }

      const executorResponse: ExecutorResponse = {
        taskId: task.id,
        result,
        reasoning: extractReasoningFromResult(result),
        toolCalls,
        success: true
      };

      // Add MCP prompt data if available (from tool execution)
      if (availableTools.length > 0 && toolResponse && toolResponse.mcpPromptData) {
        executorResponse.mcpPromptData = toolResponse.mcpPromptData;
      }

      // Add prompt data if logging is enabled
      if (enablePromptLogging) {
        const messages = [
          {
            role: 'system',
            content: availableTools.length > 0 ? EXECUTOR_SYSTEM_PROMPT : EXECUTOR_SYSTEM_PROMPT_NO_TOOLS
          },
          {
            role: 'user',
            content: executionPrompt
          }
        ];

        const requestBody: any = {
          model: actualModel,
          messages: messages,
          temperature: temperature !== undefined ? temperature : 0.7,
          max_tokens: 4000
        };

        if (seed !== undefined && seed !== -1) {
          requestBody.seed = seed;
        }

        if (availableTools.length > 0) {
          requestBody.tools = availableTools;
          requestBody.tool_choice = 'auto';
        }

        executorResponse.promptData = {
          llmRequest: {
            provider: 'openrouter.ai',
            model: actualModel,
            content: JSON.stringify(requestBody, null, 2)
          },
          llmResponse: {
            provider: 'openrouter.ai',
            model: actualModel,
            content: JSON.stringify({
              result: result,
              toolCalls: toolCalls
            }, null, 2)
          }
        };
      }

      logger.info('Task execution completed', { 
        taskId: task.id,
        toolCallsCount: toolCalls.length,
        success: true
      });

      res.json(executorResponse);

    } catch (error: any) {
      logger.error('Error in multi-agent executor', { 
        error: error.message,
        stack: error.stack,
        taskId: req.body?.task?.id
      });
      
      res.status(500).json({ 
        taskId: req.body?.task?.id || 'unknown',
        result: null,
        reasoning: 'Task execution failed',
        toolCalls: [],
        success: false,
        error: error.message 
      });
    }
  }
);

export const multiAgentMultiTaskExecutor = onRequest(
  {
    timeoutSeconds: 540,
    memory: '2GiB',
    cors: true
  },
  async (req, res) => {
    try {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        handleCorsPreflightRequest(res);
        return;
      }

      // Set CORS headers
      const corsHeaders = getCorsHeaders();
      Object.keys(corsHeaders).forEach(key => {
        res.set(key, corsHeaders[key]);
      });

      if (req.method !== 'POST') {
        logger.warn('Invalid method for multi-task executor', { method: req.method });
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const { tasks, modelSelection, temperature, seed, enablePromptLogging = false, preFilteredTools }: MultiTaskExecutorRequest = req.body;

      if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        logger.warn('Missing required tasks array', { tasksProvided: !!tasks, isArray: Array.isArray(tasks), length: tasks?.length });
        res.status(400).json({ error: 'Tasks array is required' });
        return;
      }

      // Validate each task
      for (const task of tasks) {
        if (!task.id || !task.description) {
          logger.warn('Invalid task', { taskId: task.id, hasDescription: !!task.description });
          res.status(400).json({ error: 'Each task must have id and description' });
          return;
        }
      }

      // Collect all required tools from all tasks
      const allRequiredTools = Array.from(new Set(tasks.flatMap(task => task.tools || [])));

      // Must have pre-filtered tools - no fallback
      if (!preFilteredTools || preFilteredTools.length === 0) {
        logger.error('No tools available for multi-task execution', {
          taskCount: tasks.length,
          allRequiredTools: allRequiredTools
        });
        res.status(400).json({ error: 'No tools available for execution' });
        return;
      }

      // Determine which model to use
      let actualModel = DEFAULT_MCP_MODEL;
      if (modelSelection && modelSelection.llm) {
        actualModel = modelSelection.llm.model;
      }

      logger.info('Executing multi-task request', {
        taskCount: tasks.length,
        taskIds: tasks.map(t => t.id),
        toolCount: preFilteredTools.length,
        model: actualModel
      });

      // Create simple execution prompt that just lists all tasks
      let executionPrompt = `Execute these ${tasks.length} tasks:\n\n`;
      for (const task of tasks) {
        executionPrompt += `Task ${task.id}: ${task.description}\n`;
        if (task.dependencyResults && Object.keys(task.dependencyResults).length > 0) {
          executionPrompt += `Dependencies: ${JSON.stringify(task.dependencyResults)}\n`;
        }
        executionPrompt += `\n`;
      }

      // Execute with tools
      const toolResponse = await getLLMResponseWithTools([
        {
          role: 'system',
          content: MULTI_TASK_EXECUTOR_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: executionPrompt
        }
      ], actualModel, preFilteredTools, `multitask_${tasks.map(t => t.id).join('_')}`, temperature, seed, enablePromptLogging);

      // Extract task results from tool calls - each tool call should map to a task
      const taskResults: Record<string, any> = {};

      // Map tool call results back to tasks based on the tool calls made
      if (toolResponse.toolCalls && toolResponse.toolCalls.length > 0) {
        // For now, we'll assume the tool results are in the same order as tasks
        // This is simplified - in reality we'd need smarter mapping
        toolResponse.toolCalls.forEach((toolCall: any, index: number) => {
          if (index < tasks.length) {
            taskResults[tasks[index].id] = toolCall.result;
          }
        });
      }

      const response: MultiTaskExecutorResponse = {
        taskResults,
        toolCalls: toolResponse.toolCalls || [],
        success: true
      };

      // Add MCP prompt data if available
      if (toolResponse.mcpPromptData) {
        response.mcpPromptData = toolResponse.mcpPromptData;
      }

      // Add prompt data if logging is enabled
      if (enablePromptLogging) {
        const messages = [
          {
            role: 'system',
            content: MULTI_TASK_EXECUTOR_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: executionPrompt
          }
        ];

        const requestBody: any = {
          model: actualModel,
          messages: messages,
          temperature: temperature !== undefined ? temperature : 0.7,
          max_tokens: 4000,
          tools: preFilteredTools,
          tool_choice: 'auto'
        };

        if (seed !== undefined && seed !== -1) {
          requestBody.seed = seed;
        }

        response.promptData = {
          llmRequest: {
            provider: 'openrouter.ai',
            model: actualModel,
            content: JSON.stringify(requestBody, null, 2)
          },
          llmResponse: {
            provider: 'openrouter.ai',
            model: actualModel,
            content: JSON.stringify({
              taskResults: taskResults,
              toolCalls: toolResponse.toolCalls
            }, null, 2)
          }
        };
      }

      logger.info('Multi-task execution completed', {
        taskCount: tasks.length,
        toolCallsCount: toolResponse.toolCalls?.length || 0,
        success: true
      });

      res.json(response);

    } catch (error: any) {
      logger.error('Error in multi-task executor', {
        error: error.message,
        stack: error.stack,
        taskCount: req.body?.tasks?.length || 0
      });

      res.status(500).json({
        taskResults: {},
        toolCalls: [],
        success: false,
        error: error.message
      });
    }
  }
);

const EXECUTOR_SYSTEM_PROMPT = `You are a multi-agent task executor. Your role is to complete specific tasks using the available tools.

EXECUTION GUIDELINES:
1. Read the task description carefully
2. Use dependency results from previous tasks if provided
3. Call the appropriate tools to gather information or perform actions
4. Provide clear reasoning for your approach
5. Return structured results that can be used by dependent tasks

RESPONSE FORMAT:
- Start with your reasoning approach
- Use tools as needed to complete the task
- Provide a clear summary of results
- Include any relevant data for dependent tasks

Remember: You are executing ONE specific task. Focus only on that task and use the tools efficiently.`;

const EXECUTOR_SYSTEM_PROMPT_NO_TOOLS = `You are a multi-agent task executor. Your role is to complete specific tasks using your knowledge and reasoning capabilities.

EXECUTION GUIDELINES:
1. Read the task description carefully
2. Use dependency results from previous tasks if provided
3. Apply your knowledge and reasoning to complete the task
4. Provide clear reasoning for your approach
5. Return structured results that can be used by dependent tasks

RESPONSE FORMAT:
- Start with your reasoning approach
- Complete the task using available information
- Provide a clear summary of results
- Include any relevant data for dependent tasks

Remember: You are executing ONE specific task. Focus only on that task and provide the best possible answer based on available information.`;

const MULTI_TASK_EXECUTOR_SYSTEM_PROMPT = `You are a multi-agent task executor. Execute all the provided tasks using the available tools.

Use the tools efficiently to complete all tasks. Call the required tools for each task as needed.`;

function createExecutionPrompt(task: any): string {
  let prompt = `TASK TO EXECUTE:
ID: ${task.id}
Description: ${task.description}`;

  if (task.tools && task.tools.length > 0) {
    prompt += `\nRequired Tools: ${task.tools.join(', ')}`;
  }

  if (task.dependencyResults && Object.keys(task.dependencyResults).length > 0) {
    prompt += `\n\nDEPENDENCY RESULTS:`;
    for (const [depId, result] of Object.entries(task.dependencyResults)) {
      prompt += `\n${depId}: ${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`;
    }
  }

  prompt += `\n\nPlease execute this task. Use the available tools if needed and provide clear results that can be used by dependent tasks.`;

  return prompt;
}

async function getAvailableToolsForTask(requestedTools: string[]): Promise<any[]> {
  try {
    // Import tool definitions from MCP servers
    const { getToolDefinitionsFromServers } = await import('./utils/mcp-utils');
    const allTools = await getToolDefinitionsFromServers();
    
    // Filter to only requested tools
    if (!requestedTools || requestedTools.length === 0) {
      return allTools; // Return all if no specific tools requested
    }

    const availableTools = allTools.filter(tool => 
      requestedTools.includes(tool.function.name)
    );

    logger.info('Filtered tools for task', {
      requestedCount: requestedTools.length,
      availableCount: availableTools.length,
      requestedTools,
      availableTools: availableTools.map(t => t.function.name)
    });

    return availableTools;

  } catch (error: any) {
    logger.error('Error getting tools for task', {
      error: error.message,
      requestedTools
    });
    return [];
  }
}

function extractReasoningFromResult(result: string): string {
  if (typeof result !== 'string') {
    return 'Task completed successfully';
  }

  // Try to extract reasoning from structured responses
  const lines = result.split('\n');
  const reasoningLines = lines.filter(line => 
    line.toLowerCase().includes('reasoning') ||
    line.toLowerCase().includes('approach') ||
    line.toLowerCase().includes('strategy')
  );

  if (reasoningLines.length > 0) {
    return reasoningLines[0].substring(0, 200);
  }

  // Fallback: return first meaningful line
  const meaningfulLines = lines.filter(line => 
    line.trim().length > 10 && 
    !line.includes('```')
  );

  if (meaningfulLines.length > 0) {
    return meaningfulLines[0].substring(0, 200);
  }

  return 'Task completed successfully';
}

