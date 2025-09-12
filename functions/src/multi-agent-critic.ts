import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getCorsHeaders, handleCorsPreflightRequest } from './utils/cors';
import { getLLMResponse } from './utils/llm-utils';
import { FUNCTION_CONSTANTS } from './config/function-constants';

const DEFAULT_MCP_MODEL = FUNCTION_CONSTANTS.DEFAULTS.MCP_MODEL;
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

interface CriticRequest {
  originalQuery: string;
  verification: {
    overallCorrect: boolean;
    confidence: number;
    taskVerifications: any[];
    finalAnswer: string;
    reasoning: string;
    recommendations?: string[];
  };
  taskResults?: any[];
  modelSelection?: any;
}

interface CriticResponse {
  finalAnswer: string;
  confidence: number;
  presentation: {
    structure: string;
    tone: string;
    completeness: number;
  };
  improvements?: string[];
}

export const multiAgentCritic = onRequest(
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
        logger.warn('Invalid method for critic', { method: req.method });
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const { originalQuery, verification, taskResults, modelSelection }: CriticRequest = req.body;

      if (!originalQuery || !verification) {
        logger.warn('Missing required fields for critic', { 
          hasQuery: !!originalQuery,
          hasVerification: !!verification
        });
        res.status(400).json({ error: 'Original query and verification are required' });
        return;
      }

      // Determine which model to use
      let actualModel = DEFAULT_MCP_MODEL;
      if (modelSelection && modelSelection.llm) {
        actualModel = modelSelection.llm.model;
        logger.info('Using selected model for final response', { 
          provider: modelSelection.llm.provider,
          model: actualModel
        });
      }

      logger.info('Creating final response', { 
        query: originalQuery.substring(0, 100) + '...',
        verificationConfidence: verification.confidence,
        overallCorrect: verification.overallCorrect,
        model: actualModel
      });

      if (isEmulator) {
        console.log('🎨 Multi-Agent Critic Request:', JSON.stringify({
          query: originalQuery.substring(0, 200) + '...',
          verificationConfidence: verification.confidence,
          overallCorrect: verification.overallCorrect,
          taskCount: verification.taskVerifications?.length || 0,
          finalAnswerPreview: verification.finalAnswer.substring(0, 200) + '...',
          model: actualModel
        }, null, 2));
      }

      // Create the critic prompt
      const criticPrompt = createCriticPrompt(originalQuery, verification, taskResults);

      // Get response from LLM
      const llmResponse = await getLLMResponse([
        {
          role: 'system',
          content: CRITIC_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: criticPrompt
        }
      ], actualModel);

      logger.info('LLM critic response received', { 
        responseLength: llmResponse.length 
      });

      if (isEmulator) {
        console.log('📤 Critic LLM Response:', llmResponse.substring(0, 1500) + '...');
      }

      // Parse and format the final response
      const criticResponse = parseCriticResponse(llmResponse, verification);

      logger.info('Final response created', { 
        answerLength: criticResponse.finalAnswer.length,
        confidence: criticResponse.confidence
      });

      res.json(criticResponse);

    } catch (error: any) {
      logger.error('Error in multi-agent critic', { 
        error: error.message,
        stack: error.stack 
      });
      
      // Return fallback response based on verification
      res.status(500).json({ 
        finalAnswer: req.body?.verification?.finalAnswer || 'I apologize, but I encountered an error while formatting the final response.',
        confidence: req.body?.verification?.confidence || 50,
        presentation: {
          structure: 'error_fallback',
          tone: 'apologetic',
          completeness: 50
        },
        improvements: ['Address the error that occurred in response formatting'],
        error: error.message 
      });
    }
  }
);

const CRITIC_SYSTEM_PROMPT = `You are a multi-agent response critic and formatter. Your role is to create the final, user-friendly response based on verified task results.

CRITIC RESPONSIBILITIES:
1. Transform verified technical results into clear, user-friendly language
2. Ensure the response directly addresses the original query
3. Structure information logically and readably
4. Maintain appropriate tone and confidence level
5. Highlight key insights and actionable information

RESPONSE GUIDELINES:
- Write in clear, conversational language
- Structure information with appropriate formatting (use markdown)
- Be concise but comprehensive
- Match confidence level to verification results
- Address the user's question directly
- Include relevant details without overwhelming
- Use bullet points, headers, and formatting for clarity

QUALITY STANDARDS:
- Accuracy: Based on verified results
- Clarity: Easy to understand
- Completeness: Addresses all aspects of the query
- Relevance: Focused on what the user asked
- Professional: Well-structured and polished

Create a response that the user will find helpful, accurate, and easy to understand.`;

function createCriticPrompt(originalQuery: string, verification: any, taskResults?: any[]): string {
  let prompt = `ORIGINAL USER QUERY: ${originalQuery}

VERIFICATION RESULTS:
- Overall Correct: ${verification.overallCorrect}
- Confidence: ${verification.confidence}%
- Verified Answer: ${verification.finalAnswer}
- Reasoning: ${verification.reasoning}`;

  if (verification.taskVerifications && verification.taskVerifications.length > 0) {
    prompt += `\n\nTASK VERIFICATION DETAILS:`;
    verification.taskVerifications.forEach((taskVerif: any) => {
      prompt += `\n- Task ${taskVerif.taskId}: ${taskVerif.isCorrect ? 'CORRECT' : 'INCORRECT'} (${taskVerif.confidence}% confidence)`;
      prompt += `\n  Reasoning: ${taskVerif.reasoning}`;
      if (taskVerif.issues && taskVerif.issues.length > 0) {
        prompt += `\n  Issues: ${taskVerif.issues.join(', ')}`;
      }
    });
  }

  if (verification.recommendations && verification.recommendations.length > 0) {
    prompt += `\n\nRECOMMENDATIONS:`;
    verification.recommendations.forEach((rec: string) => {
      prompt += `\n- ${rec}`;
    });
  }

  if (taskResults && taskResults.length > 0) {
    prompt += `\n\nDETAILED TASK RESULTS:`;
    taskResults.forEach((result: any, index: number) => {
      prompt += `\n${index + 1}. ${typeof result === 'string' ? result : JSON.stringify(result)}`;
    });
  }

  prompt += `\n\nPlease create a final, user-friendly response that:
1. Directly answers the original query
2. Is clear and well-structured
3. Reflects the appropriate confidence level
4. Uses good formatting for readability
5. Maintains a helpful, professional tone

Focus on what the user actually needs to know, presented in the most helpful way possible.`;

  return prompt;
}

function parseCriticResponse(response: string, verification: any): CriticResponse {
  // The critic response is typically the formatted final answer
  // We don't expect structured JSON here, just a well-formatted response
  
  const finalAnswer = response.trim();
  
  // Assess the response quality
  const wordCount = finalAnswer.split(' ').length;
  const hasFormatting = finalAnswer.includes('#') || finalAnswer.includes('*') || finalAnswer.includes('-');
  const hasStructure = finalAnswer.includes('\n\n') || finalAnswer.includes('\n#') || finalAnswer.includes('\n-');
  
  // Calculate completeness score
  let completeness = 70; // Base score
  if (wordCount > 50) completeness += 10;
  if (wordCount > 100) completeness += 10;
  if (hasFormatting) completeness += 5;
  if (hasStructure) completeness += 5;
  completeness = Math.min(100, completeness);
  
  // Determine tone
  let tone = 'professional';
  if (finalAnswer.toLowerCase().includes('sorry') || finalAnswer.toLowerCase().includes('unfortunately')) {
    tone = 'apologetic';
  } else if (finalAnswer.includes('!') || finalAnswer.toLowerCase().includes('great')) {
    tone = 'enthusiastic';
  } else if (verification.confidence < 70) {
    tone = 'cautious';
  }
  
  // Determine structure
  let structure = 'paragraph';
  if (finalAnswer.includes('\n#')) {
    structure = 'sectioned';
  } else if (finalAnswer.includes('\n-') || finalAnswer.includes('\n*')) {
    structure = 'bulleted';
  } else if (finalAnswer.includes('\n\n')) {
    structure = 'multi_paragraph';
  }

  // Generate improvements if confidence is low
  const improvements: string[] = [];
  if (verification.confidence < 80) {
    improvements.push('Consider gathering additional information for higher confidence');
  }
  if (completeness < 80) {
    improvements.push('Response could be more comprehensive');
  }
  if (!hasFormatting && wordCount > 100) {
    improvements.push('Consider using formatting for better readability');
  }

  return {
    finalAnswer,
    confidence: verification.confidence,
    presentation: {
      structure,
      tone,
      completeness
    },
    improvements: improvements.length > 0 ? improvements : undefined
  };
}