import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getCorsHeaders, handleCorsPreflightRequest } from './utils/cors';
import { getLLMResponse } from './utils/llm-utils';
import { FUNCTION_CONSTANTS } from './config/function-constants';

const DEFAULT_MCP_MODEL = FUNCTION_CONSTANTS.DEFAULTS.MCP_MODEL;
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

interface PlannerRequest {
  query: string;
  availableTools: {
    name: string;
    description: string;
    serverId: string;
    inputSchema: any;
  }[];
  modelSelection?: any;
  temperature?: number;
  seed?: number;
  enablePromptLogging?: boolean;
}

interface Task {
  id: string;
  description: string;
  dependencies: string[];
  tools: string[];
  reasoning?: string;
}

interface PlannerResponse {
  tasks: Task[];
  totalSteps: number;
  reasoning: string;
  promptData?: {
    llmRequest?: any;
    llmResponse?: any;
  };
}

export const multiAgentPlanner = onRequest(
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
        logger.warn('Invalid method for planner', { method: req.method });
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const { query, availableTools, modelSelection, temperature, seed, enablePromptLogging = false }: PlannerRequest = req.body;

      if (!query || !availableTools) {
        logger.warn('Missing required fields', { query: !!query, availableTools: !!availableTools });
        res.status(400).json({ error: 'Query and available tools are required' });
        return;
      }

      // Determine which model to use
      let actualModel = DEFAULT_MCP_MODEL;
      if (modelSelection && modelSelection.llm) {
        actualModel = modelSelection.llm.model;
        logger.info('Using selected model for planning', { 
          provider: modelSelection.llm.provider,
          model: actualModel
        });
      }

      logger.info('Planning multi-agent execution', { 
        query: query.substring(0, 100) + '...', 
        toolCount: availableTools.length,
        model: actualModel
      });

      if (isEmulator) {
        console.log('🤖 Multi-Agent Planner Request:', JSON.stringify({
          query: query.substring(0, 200) + '...',
          availableTools: availableTools.map(t => ({
            name: t.name,
            description: t.description.substring(0, 100) + '...',
            serverId: t.serverId
          })),
          toolCount: availableTools.length,
          model: actualModel
        }, null, 2));
      }

      // Create the planning prompt
      const planningPrompt = createPlanningPrompt(query, availableTools);

      if (isEmulator) {
        console.log('📝 Planner System Prompt:', PLANNER_SYSTEM_PROMPT.substring(0, 500) + '...');
        console.log('📝 Planner User Prompt:', planningPrompt.substring(0, 1000) + '...');
      }

      // Get response from LLM
      const llmResponse = await getLLMResponse([
        {
          role: 'system',
          content: PLANNER_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: planningPrompt
        }
      ], actualModel, temperature, seed);

      logger.info('LLM planning response received', { 
        responseLength: llmResponse.length 
      });

      if (isEmulator) {
        console.log('📤 Planner LLM Response:', llmResponse.substring(0, 2000) + '...');
      }

      // Parse the structured response
      const plannerResponse = parsePlannerResponse(llmResponse);

      if (isEmulator) {
        console.log('🧩 Parsed Plan:', JSON.stringify({
          taskCount: plannerResponse.tasks.length,
          totalSteps: plannerResponse.totalSteps,
          tasks: plannerResponse.tasks.map(t => ({
            id: t.id,
            description: t.description.substring(0, 100) + '...',
            dependencies: t.dependencies,
            tools: t.tools
          }))
        }, null, 2));
      }

      // Validate the plan
      validatePlan(plannerResponse);

      // Add prompt data if logging is enabled
      if (enablePromptLogging) {
        const requestBody: any = {
          model: actualModel,
          messages: [
            {
              role: 'system',
              content: PLANNER_SYSTEM_PROMPT
            },
            {
              role: 'user', 
              content: planningPrompt
            }
          ],
          temperature: temperature !== undefined ? temperature : 0.7,
          max_tokens: 4000
        };

        if (seed !== undefined && seed !== -1) {
          requestBody.seed = seed;
        }

        plannerResponse.promptData = {
          llmRequest: {
            provider: 'openrouter.ai',
            model: actualModel,
            content: JSON.stringify(requestBody, null, 2)
          },
          llmResponse: {
            provider: 'openrouter.ai',
            model: actualModel,
            content: llmResponse
          }
        };
      }

      logger.info('Plan created successfully', { 
        taskCount: plannerResponse.tasks.length,
        totalSteps: plannerResponse.totalSteps
      });

      res.json(plannerResponse);

    } catch (error: any) {
      logger.error('Error in multi-agent planner', { 
        error: error.message,
        stack: error.stack 
      });
      
      res.status(500).json({ 
        error: 'Planning failed',
        details: error.message 
      });
    }
  }
);

const PLANNER_SYSTEM_PROMPT = `You are a multi-agent task planner. Your role is to break down complex user queries into executable tasks that can be performed using available tools.

CRITICAL REQUIREMENTS:
1. Create a step-by-step plan with clear dependencies
2. Optimize for parallel execution where possible
3. Use ONLY the tools provided in the available tools list
4. Return a valid JSON response in the exact format specified
5. Each task should be atomic and executable in a single LLM call
6. Dependencies should be minimal to maximize parallelization

RESPONSE FORMAT:
You MUST respond with valid JSON in this exact structure:
{
  "reasoning": "Brief explanation of your planning strategy",
  "tasks": [
    {
      "id": "task_1",
      "description": "Clear, actionable task description",
      "dependencies": [],
      "tools": ["tool_name"],
      "reasoning": "Why this task is needed"
    }
  ],
  "totalSteps": 3
}

PLANNING GUIDELINES:
- Task IDs should be sequential: task_1, task_2, etc.
- Dependencies are task IDs that must complete before this task
- Tools array should contain only tool names from available tools
- Descriptions should be clear instructions for execution
- Minimize dependencies to allow parallel execution
- Each task should have a single, focused objective`;

function createPlanningPrompt(query: string, availableTools: any[]): string {
  const toolsList = availableTools.map(tool => 
    `- ${tool.name}: ${tool.description} (Server: ${tool.serverId})`
  ).join('\n');

  return `USER QUERY: ${query}

AVAILABLE TOOLS:
${toolsList}

Create an execution plan that breaks down the user query into executable tasks. Focus on:
1. Task decomposition with clear dependencies
2. Optimal use of available tools
3. Parallel execution opportunities
4. Clear, actionable task descriptions

Return your response as valid JSON following the specified format.`;
}

function parsePlannerResponse(response: string): PlannerResponse {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response.trim();
    
    // Remove markdown code block markers if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```\n/, '').replace(/\n```$/, '');
    }

    const parsed = JSON.parse(jsonStr);

    if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
      throw new Error('Invalid response: tasks array is required');
    }

    // Ensure required fields exist
    const tasks: Task[] = parsed.tasks.map((task: any, index: number) => ({
      id: task.id || `task_${index + 1}`,
      description: task.description || `Task ${index + 1}`,
      dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
      tools: Array.isArray(task.tools) ? task.tools : [],
      reasoning: task.reasoning || ''
    }));

    return {
      tasks,
      totalSteps: parsed.totalSteps || tasks.length,
      reasoning: parsed.reasoning || 'Plan created'
    };

  } catch (error: any) {
    logger.error('Failed to parse planner response', { 
      response: response.substring(0, 500),
      error: error.message 
    });
    
    // Fallback: create a simple single-task plan
    return {
      tasks: [{
        id: 'task_1',
        description: 'Execute the user query using available tools',
        dependencies: [],
        tools: [],
        reasoning: 'Fallback plan due to parsing error'
      }],
      totalSteps: 1,
      reasoning: 'Fallback plan created due to response parsing error'
    };
  }
}

function validatePlan(plan: PlannerResponse): void {
  const taskIds = new Set(plan.tasks.map(t => t.id));
  
  // Check for duplicate task IDs
  if (taskIds.size !== plan.tasks.length) {
    throw new Error('Duplicate task IDs detected in plan');
  }

  // Check for invalid dependencies
  for (const task of plan.tasks) {
    for (const dependency of task.dependencies) {
      if (!taskIds.has(dependency)) {
        logger.warn('Task references non-existent dependency', { 
          taskId: task.id, 
          dependency 
        });
        // Remove invalid dependency instead of failing
        task.dependencies = task.dependencies.filter(dep => dep !== dependency);
      }
    }
    
    // Check for self-dependencies
    if (task.dependencies.includes(task.id)) {
      logger.warn('Task has self-dependency, removing', { taskId: task.id });
      task.dependencies = task.dependencies.filter(dep => dep !== task.id);
    }
  }

  // Validate task descriptions
  for (const task of plan.tasks) {
    if (!task.description || task.description.trim().length === 0) {
      throw new Error(`Task ${task.id} has empty description`);
    }
  }

  logger.info('Plan validation completed', { 
    taskCount: plan.tasks.length,
    totalDependencies: plan.tasks.reduce((sum, t) => sum + t.dependencies.length, 0)
  });
}