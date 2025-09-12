import { logger } from 'firebase-functions';
import fetch from 'node-fetch';
import { modelsConfigService } from '../models-config';
// Helper function to handle LLM API errors
function handleLlmApiError(status: number, errorText: string, provider: string): never {
  logger.error('LLM API Error', { provider, status, errorText });
  
  if (status === 429 && provider === 'openrouter.ai') {
    // Check if it's a rate limit error
    try {
      const errorData = JSON.parse(errorText);
      if (errorData.error?.metadata?.raw?.includes('rate-limited upstream')) {
        throw new Error('This model is rate limited, please choose a different model');
      }
    } catch (parseError) {
      // If we can't parse the error, check if the text contains rate limit indicators
      if (errorText.includes('rate-limited') || errorText.includes('rate limit')) {
        throw new Error('This model is rate limited, please choose a different model');
      }
    }
  }

  if (status === 401) {
    throw new Error('Authentication failed - check API key');
  } else if (status === 403) {
    throw new Error('Access forbidden - insufficient permissions');
  } else if (status >= 500) {
    throw new Error(`LLM provider error: ${errorText}`);
  } else {
    throw new Error(`LLM API error (${status}): ${errorText}`);
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: any[];
}

export interface ToolCallResponse {
  content: string;
  toolCalls: any[];
}

const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

export async function getLLMResponse(
  messages: ChatMessage[], 
  model?: string,
  temperature?: number,
  seed?: number
): Promise<string> {
  
  const actualLlmModel = model || 'meta-llama/llama-4-maverick:free';
  const actualLlmProvider = 'openrouter.ai'; // Default for multi-agent system
  
  // Get LLM API key
  const llmApiKeyEnvVar = modelsConfigService.getApiKeyEnvVar(actualLlmProvider);
  const llmKey = process.env[llmApiKeyEnvVar];
  
  if (!llmKey) {
    logger.error(`${llmApiKeyEnvVar} not found`);
    throw new Error(`${llmApiKeyEnvVar} not configured`);
  }

  const llmApiUrl = modelsConfigService.getProviderApiUrl(actualLlmProvider, 'LLM');
  if (!llmApiUrl) {
    throw new Error(`No API URL configured for provider ${actualLlmProvider}`);
  }

  // Build headers
  const llmHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${llmKey}`
  };

  // Add provider-specific headers
  if (actualLlmProvider === 'openrouter.ai') {
    llmHeaders['HTTP-Referer'] = 'https://aiplayground-6e5be.web.app';
    llmHeaders['X-Title'] = 'AI Playground Multi-Agent System';
  }

  const llmRequestBody: any = {
    model: actualLlmModel,
    messages,
    temperature: temperature !== undefined ? temperature : 0.7,
    max_tokens: 4000
  };

  // Add seed if provided (omit if -1 or undefined to let provider randomize)
  if (seed !== undefined && seed !== -1) {
    llmRequestBody.seed = seed;
  }

  logger.info('LLM Request', { 
    provider: actualLlmProvider, 
    model: actualLlmModel,
    messageCount: messages.length
  });

  if (isEmulator) {
    console.log('🔍 LLM Request Details:', JSON.stringify({
      provider: actualLlmProvider,
      model: actualLlmModel,
      url: llmApiUrl,
      messageCount: messages.length,
      temperature: llmRequestBody.temperature,
      seed: llmRequestBody.seed,
      messages: messages.map(m => ({
        role: m.role,
        contentLength: m.content.length
      }))
    }, null, 2));
  }

  const llmResponse = await fetch(llmApiUrl, {
    method: 'POST',
    headers: llmHeaders,
    body: JSON.stringify(llmRequestBody)
  });

  if (!llmResponse.ok) {
    const errorText = await llmResponse.text();
    handleLlmApiError(llmResponse.status, errorText, actualLlmProvider);
  }

  const llmJson = await llmResponse.json() as any;
  const answer = llmJson.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response.';

  logger.info('LLM Response received', { 
    provider: actualLlmProvider,
    model: actualLlmModel,
    status: llmResponse.status,
    answerLength: answer.length
  });

  if (isEmulator) {
    console.log('📤 LLM Response:', JSON.stringify({
      provider: actualLlmProvider,
      model: actualLlmModel,
      status: llmResponse.status,
      answerLength: answer.length,
      answerPreview: answer.substring(0, 200) + '...'
    }, null, 2));
  }

  return answer;
}

export async function getLLMResponseWithTools(
  messages: ChatMessage[], 
  model?: string,
  tools?: any[],
  taskId?: string,
  temperature?: number,
  seed?: number
): Promise<ToolCallResponse> {
  
  const actualLlmModel = model || 'meta-llama/llama-4-maverick:free';
  const actualLlmProvider = 'openrouter.ai';
  
  // Get LLM API key
  const llmApiKeyEnvVar = modelsConfigService.getApiKeyEnvVar(actualLlmProvider);
  const llmKey = process.env[llmApiKeyEnvVar];
  
  if (!llmKey) {
    logger.error(`${llmApiKeyEnvVar} not found`);
    throw new Error(`${llmApiKeyEnvVar} not configured`);
  }

  const llmApiUrl = modelsConfigService.getProviderApiUrl(actualLlmProvider, 'LLM');
  if (!llmApiUrl) {
    throw new Error(`No API URL configured for provider ${actualLlmProvider}`);
  }

  // Build headers
  const llmHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${llmKey}`
  };

  if (actualLlmProvider === 'openrouter.ai') {
    llmHeaders['HTTP-Referer'] = 'https://aiplayground-6e5be.web.app';
    llmHeaders['X-Title'] = 'AI Playground Multi-Agent System';
  }

  const llmRequestBody: any = {
    model: actualLlmModel,
    messages,
    temperature: temperature !== undefined ? temperature : 0.7,
    max_tokens: 4000
  };

  // Add seed if provided (omit if -1 or undefined to let provider randomize)
  if (seed !== undefined && seed !== -1) {
    llmRequestBody.seed = seed;
  }

  // Add tools if provided
  if (tools && tools.length > 0) {
    llmRequestBody.tools = tools;
    llmRequestBody.tool_choice = 'auto';
  }

  logger.info('LLM Request with tools', { 
    provider: actualLlmProvider, 
    model: actualLlmModel,
    messageCount: messages.length,
    toolCount: tools?.length || 0,
    taskId
  });

  if (isEmulator) {
    console.log('🔧 LLM Request with Tools:', JSON.stringify({
      provider: actualLlmProvider,
      model: actualLlmModel,
      url: llmApiUrl,
      messageCount: messages.length,
      temperature: llmRequestBody.temperature,
      seed: llmRequestBody.seed,
      toolCount: tools?.length || 0,
      hasTools: !!(tools && tools.length > 0),
      taskId,
      tools: tools?.map(t => ({
        name: t.function.name,
        description: t.function.description.substring(0, 100) + '...'
      })) || []
    }, null, 2));
  }

  const llmResponse = await fetch(llmApiUrl, {
    method: 'POST',
    headers: llmHeaders,
    body: JSON.stringify(llmRequestBody)
  });

  if (!llmResponse.ok) {
    const errorText = await llmResponse.text();
    handleLlmApiError(llmResponse.status, errorText, actualLlmProvider);
  }

  const llmJson = await llmResponse.json() as any;
  const message = llmJson.choices?.[0]?.message;
  
  if (!message) {
    throw new Error('No message in LLM response');
  }

  const content = message.content || 'No content generated';
  const toolCalls = message.tool_calls || [];

  logger.info('LLM Response with tools received', { 
    provider: actualLlmProvider,
    model: actualLlmModel,
    contentLength: content.length,
    toolCallsCount: toolCalls.length,
    taskId
  });

  if (isEmulator) {
    console.log('🔧 LLM Tool Response:', JSON.stringify({
      provider: actualLlmProvider,
      model: actualLlmModel,
      contentLength: content.length,
      toolCallsCount: toolCalls.length,
      taskId,
      content: content.substring(0, 300) + '...',
      toolCalls: toolCalls.map((tc: any) => ({
        id: tc.id,
        functionName: tc.function?.name,
        arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
      }))
    }, null, 2));
  }

  // If there are tool calls, execute them
  if (toolCalls.length > 0) {
    const { callMcpTool } = await import('./mcp-utils');
    const toolResults = [];

    for (const toolCall of toolCalls) {
      try {
        const result = await callMcpTool(
          toolCall.function.name,
          JSON.parse(toolCall.function.arguments || '{}')
        );
        toolResults.push({
          toolCall,
          result
        });
      } catch (error: any) {
        logger.error('Tool call failed', {
          toolName: toolCall.function.name,
          error: error.message,
          taskId
        });
        toolResults.push({
          toolCall,
          result: { error: error.message }
        });
      }
    }

    // Make a follow-up call with tool results
    const followUpMessages = [
      ...messages,
      message,
      ...toolResults.map(tr => ({
        role: 'tool' as const,
        content: JSON.stringify(tr.result),
        tool_call_id: tr.toolCall.id
      }))
    ];

    const followUpResponse = await getLLMResponse(followUpMessages, model);
    
    return {
      content: followUpResponse,
      toolCalls: toolResults
    };
  }

  return {
    content,
    toolCalls: []
  };
}