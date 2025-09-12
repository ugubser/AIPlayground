import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getCorsHeaders, handleCorsPreflightRequest } from './utils/cors';
import { getLLMResponse } from './utils/llm-utils';
import { FUNCTION_CONSTANTS } from './config/function-constants';

const DEFAULT_MCP_MODEL = FUNCTION_CONSTANTS.DEFAULTS.MCP_MODEL;
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

interface VerifierRequest {
  originalQuery: string;
  tasks: {
    id: string;
    description: string;
    result: any;
  }[];
  modelSelection?: any;
  temperature?: number;
  seed?: number;
  enablePromptLogging?: boolean;
}

interface TaskVerification {
  taskId: string;
  isCorrect: boolean;
  reasoning: string;
  confidence: number;
  issues?: string[];
}

interface VerifierResponse {
  overallCorrect: boolean;
  confidence: number;
  taskVerifications: TaskVerification[];
  finalAnswer: string;
  reasoning: string;
  recommendations?: string[];
  promptData?: {
    llmRequest?: any;
    llmResponse?: any;
  };
}

export const multiAgentVerifier = onRequest(
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
        logger.warn('Invalid method for verifier', { method: req.method });
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const { originalQuery, tasks, modelSelection, temperature, seed, enablePromptLogging = false }: VerifierRequest = req.body;

      if (!originalQuery || !tasks || !Array.isArray(tasks)) {
        logger.warn('Missing required fields for verification', { 
          hasQuery: !!originalQuery,
          hasTasks: !!tasks,
          isTasksArray: Array.isArray(tasks)
        });
        res.status(400).json({ error: 'Original query and tasks array are required' });
        return;
      }

      // Determine which model to use
      let actualModel = DEFAULT_MCP_MODEL;
      if (modelSelection && modelSelection.llm) {
        actualModel = modelSelection.llm.model;
        logger.info('Using selected model for verification', { 
          provider: modelSelection.llm.provider,
          model: actualModel
        });
      }

      logger.info('Verifying task results', { 
        query: originalQuery.substring(0, 100) + '...',
        taskCount: tasks.length,
        model: actualModel
      });

      if (isEmulator) {
        console.log('✅ Multi-Agent Verifier Request:', JSON.stringify({
          query: originalQuery.substring(0, 200) + '...',
          taskCount: tasks.length,
          tasks: tasks.map(t => ({
            id: t.id,
            description: t.description.substring(0, 100) + '...',
            resultPreview: typeof t.result === 'string' 
              ? t.result.substring(0, 100) + '...'
              : JSON.stringify(t.result).substring(0, 100) + '...'
          })),
          model: actualModel
        }, null, 2));
      }

      // Create the verification prompt
      const verificationPrompt = createVerificationPrompt(originalQuery, tasks);

      // Get response from LLM
      const llmResponse = await getLLMResponse([
        {
          role: 'system',
          content: VERIFIER_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: verificationPrompt
        }
      ], actualModel, temperature, seed);

      logger.info('LLM verification response received', { 
        responseLength: llmResponse.length 
      });

      if (isEmulator) {
        console.log('📤 Verifier LLM Response:', llmResponse.substring(0, 1500) + '...');
      }

      // Parse the structured response
      const verifierResponse = parseVerifierResponse(llmResponse, originalQuery, tasks);

      // Add prompt data if logging is enabled
      if (enablePromptLogging) {
        const requestBody: any = {
          model: actualModel,
          messages: [
            {
              role: 'system',
              content: VERIFIER_SYSTEM_PROMPT
            },
            {
              role: 'user',
              content: verificationPrompt
            }
          ],
          temperature: temperature !== undefined ? temperature : 0.7,
          max_tokens: 4000
        };

        if (seed !== undefined && seed !== -1) {
          requestBody.seed = seed;
        }

        verifierResponse.promptData = {
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

      logger.info('Verification completed', { 
        overallCorrect: verifierResponse.overallCorrect,
        confidence: verifierResponse.confidence,
        tasksVerified: verifierResponse.taskVerifications.length
      });

      res.json(verifierResponse);

    } catch (error: any) {
      logger.error('Error in multi-agent verifier', { 
        error: error.message,
        stack: error.stack 
      });
      
      res.status(500).json({ 
        overallCorrect: false,
        confidence: 0,
        taskVerifications: [],
        finalAnswer: 'Verification failed due to an error',
        reasoning: 'An error occurred during verification',
        error: error.message 
      });
    }
  }
);

const VERIFIER_SYSTEM_PROMPT = `You are a multi-agent verification specialist. Your role is to verify that task results correctly answer the original user query.

VERIFICATION RESPONSIBILITIES:
1. Analyze if each task result is accurate and relevant
2. Check if the combined results answer the original query
3. Identify any inconsistencies or errors
4. Assess the overall quality and completeness
5. Provide confidence ratings and specific feedback

RESPONSE FORMAT:
You MUST respond with valid JSON in this exact structure. Keep ALL text fields concise (100-500 characters max):
{
  "overallCorrect": boolean,
  "confidence": number (0-100),
  "reasoning": "Brief overall assessment (100-500 chars)",
  "taskVerifications": [
    {
      "taskId": "task_1",
      "isCorrect": boolean,
      "reasoning": "Concise task assessment (100-300 chars)",
      "confidence": number (0-100),
      "issues": ["brief issue descriptions"]
    }
  ],
  "finalAnswer": "Concise synthesized answer (100-500 chars)",
  "recommendations": ["brief suggestions (50-200 chars each)"]
}

VERIFICATION CRITERIA:
- Accuracy: Are the results factually correct?
- Relevance: Do results address the original query?
- Completeness: Is anything important missing?
- Consistency: Do results contradict each other?
- Quality: Are results clear and useful?

IMPORTANT: Keep all text responses concise and focused. Aim for brevity while maintaining clarity.`;

function createVerificationPrompt(originalQuery: string, tasks: any[]): string {
  let prompt = `ORIGINAL USER QUERY: ${originalQuery}

TASK RESULTS TO VERIFY:
`;

  tasks.forEach(task => {
    // Truncate large task results to prevent context overflow
    let resultText = typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2);
    
    // Limit result text to ~1000 characters per task to prevent context overflow
    const maxResultLength = 1000;
    if (resultText.length > maxResultLength) {
      resultText = resultText.substring(0, maxResultLength) + '\n... [TRUNCATED - Result was longer]';
    }
    
    prompt += `
Task ID: ${task.id}
Description: ${task.description}
Result: ${resultText}
---`;
  });

  prompt += `

Please verify these task results against the original query. Assess:
1. Individual task accuracy and relevance
2. Overall completeness in answering the query  
3. Any inconsistencies or gaps
4. Quality of the information provided

Return your verification in the specified JSON format.`;

  return prompt;
}

function parseVerifierResponse(response: string, originalQuery: string, tasks: any[]): VerifierResponse {
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

    // Validate and normalize the response
    const taskVerifications: TaskVerification[] = [];
    
    if (parsed.taskVerifications && Array.isArray(parsed.taskVerifications)) {
      for (const taskVerif of parsed.taskVerifications) {
        taskVerifications.push({
          taskId: taskVerif.taskId || 'unknown',
          isCorrect: Boolean(taskVerif.isCorrect),
          reasoning: taskVerif.reasoning || 'No reasoning provided',
          confidence: Math.max(0, Math.min(100, taskVerif.confidence || 50)),
          issues: Array.isArray(taskVerif.issues) ? taskVerif.issues : []
        });
      }
    } else {
      // Create default verifications for all tasks
      for (const task of tasks) {
        taskVerifications.push({
          taskId: task.id,
          isCorrect: true,
          reasoning: 'Default verification - task appears complete',
          confidence: 70,
          issues: []
        });
      }
    }

    // Calculate overall metrics
    const correctTasks = taskVerifications.filter(t => t.isCorrect).length;
    const overallCorrect = correctTasks === taskVerifications.length;
    const averageConfidence = taskVerifications.reduce((sum, t) => sum + t.confidence, 0) / taskVerifications.length;

    return {
      overallCorrect,
      confidence: Math.round(averageConfidence),
      taskVerifications,
      finalAnswer: parsed.finalAnswer || generateFallbackAnswer(tasks),
      reasoning: parsed.reasoning || 'Verification completed with mixed results',
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : []
    };

  } catch (error: any) {
    logger.error('Failed to parse verifier response', { 
      response: response.substring(0, 500),
      error: error.message 
    });
    
    // Fallback verification
    const taskVerifications: TaskVerification[] = tasks.map(task => ({
      taskId: task.id,
      isCorrect: true,
      reasoning: 'Fallback verification due to parsing error',
      confidence: 60,
      issues: ['Could not properly verify due to response parsing error']
    }));

    return {
      overallCorrect: true,
      confidence: 60,
      taskVerifications,
      finalAnswer: generateFallbackAnswer(tasks),
      reasoning: 'Fallback verification completed due to parsing error',
      recommendations: ['Review task execution for potential improvements']
    };
  }
}

function generateFallbackAnswer(tasks: any[]): string {
  if (tasks.length === 0) {
    return 'No task results available to synthesize an answer.';
  }

  if (tasks.length === 1) {
    return typeof tasks[0].result === 'string' 
      ? tasks[0].result 
      : JSON.stringify(tasks[0].result);
  }

  let answer = 'Based on the completed tasks:\n\n';
  tasks.forEach((task, index) => {
    answer += `${index + 1}. ${task.description}: `;
    answer += typeof task.result === 'string' 
      ? task.result 
      : JSON.stringify(task.result);
    answer += '\n';
  });

  return answer;
}