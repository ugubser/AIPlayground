import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import { modelsConfigService } from './models-config';

admin.initializeApp();
const db = admin.firestore();

const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const embedChunks = functions
  .runWith({ timeoutSeconds: 540, memory: '2GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }
    
    const { 
      texts, 
      provider = 'together.ai', 
      model = 'BAAI/bge-base-en-v1.5' 
    } = data as { 
      texts: string[]; 
      provider?: string; 
      model?: string; 
    };
    
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'texts array required');
    }

    if (texts.length > 256) {
      throw new functions.https.HttpsError('invalid-argument', 'Maximum 256 texts per batch');
    }

    // Validate provider supports embeddings
    if (!modelsConfigService.supportsEmbeddings(provider)) {
      throw new functions.https.HttpsError('invalid-argument', `Provider ${provider} does not support embeddings`);
    }

    // Get API key based on provider
    const apiKeyEnvVar = modelsConfigService.getApiKeyEnvVar(provider);
    const key = process.env[apiKeyEnvVar];
    if (!key) {
      console.error(`${apiKeyEnvVar} not found in environment`);
      throw new functions.https.HttpsError('internal', `${apiKeyEnvVar} not configured`);
    }
    console.log(`${apiKeyEnvVar} found:`, !!key);

    // Get API URL based on provider
    const apiUrl = modelsConfigService.getProviderApiUrl(provider, 'EMBED');
    if (!apiUrl) {
      throw new functions.https.HttpsError('internal', `No API URL configured for provider ${provider} and model type EMBED`);
    }

    try {
      console.log(`Processing ${texts.length} texts for embeddings using ${provider}/${model}`);
      
      const requestBody = {
        model,
        input: texts
      };

      const headers = modelsConfigService.getProviderHeaders(provider, key);

      if (isEmulator) {
        console.log('🔍 Embedding Request:', JSON.stringify({
          provider,
          model,
          url: apiUrl,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key.substring(0, 10)}...`,
            'Content-Type': 'application/json'
          },
          body: requestBody
        }, null, 2));
      }
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`${provider} API error:`, {
          status: response.status,
          statusText: response.statusText,
          url: apiUrl,
          error: errorText,
          hasApiKey: !!key
        });
        throw new functions.https.HttpsError('internal', `${provider} API error: ${response.statusText} - ${errorText}`);
      }

      const json = await response.json() as any;
      const vectors = (json.data || []).map((d: any) => d.embedding);
      
      if (isEmulator) {
        console.log(`📤 ${provider} Response:`, JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          data: {
            model: json.model,
            usage: json.usage,
            vectorCount: vectors.length,
            firstVectorLength: vectors[0]?.length || 0
          }
        }, null, 2));
      }
      
      if (vectors.length !== texts.length) {
        throw new functions.https.HttpsError('internal', 'Mismatch between input and output lengths');
      }

      console.log(`Successfully generated ${vectors.length} embeddings`);
      return { vectors };
      
    } catch (error) {
      console.error('Error in embedChunks:', error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError('internal', 'Failed to generate embeddings');
    }
  });

export const chatRag = functions
  .runWith({ timeoutSeconds: 60, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const { 
      sessionId, 
      message, 
      k = 8, 
      restrictDocId,
      llmProvider,
      llmModel,
      embedProvider,
      embedModel
    } = data;

    // Use provided models from UI - these should always be provided by the frontend
    // Fallback to config defaults only if UI doesn't provide them
    const defaults = modelsConfigService.getDefaultSelection('rag') as any;
    const actualLlmProvider = llmProvider || defaults?.llm?.provider || 'openrouter.ai';
    const actualLlmModel = llmModel || defaults?.llm?.model || 'openai/gpt-oss-20b:free';
    const actualEmbedProvider = embedProvider || defaults?.embed?.provider || 'together.ai';
    const actualEmbedModel = embedModel || defaults?.embed?.model || 'BAAI/bge-base-en-v1.5';

    console.log('Received model parameters:', { llmProvider, llmModel, embedProvider, embedModel });
    console.log('Using models:', { actualLlmProvider, actualLlmModel, actualEmbedProvider, actualEmbedModel });
    
    if (!sessionId || !message) {
      throw new functions.https.HttpsError('invalid-argument', 'sessionId and message required');
    }

    const uid = context.auth.uid;

    try {
      console.log(`Processing RAG query for user ${uid}: "${message.substring(0, 100)}..." using LLM: ${actualLlmProvider}/${actualLlmModel}, Embed: ${actualEmbedProvider}/${actualEmbedModel}`);

      // 1) Embed the query
      // Validate embed provider supports embeddings
      if (!modelsConfigService.supportsEmbeddings(actualEmbedProvider)) {
        throw new functions.https.HttpsError('invalid-argument', `Provider ${actualEmbedProvider} does not support embeddings`);
      }

      const embedApiKeyEnvVar = modelsConfigService.getApiKeyEnvVar(actualEmbedProvider);
      const embedKey = process.env[embedApiKeyEnvVar];
      if (!embedKey) {
        console.error(`${embedApiKeyEnvVar} not found for embedding`);
        throw new functions.https.HttpsError('internal', `${embedApiKeyEnvVar} not configured`);
      }

      const embedApiUrl = modelsConfigService.getProviderApiUrl(actualEmbedProvider, 'EMBED');
      if (!embedApiUrl) {
        throw new functions.https.HttpsError('internal', `No API URL configured for provider ${actualEmbedProvider} and model type EMBED`);
      }

      const queryRequestBody = { 
        model: actualEmbedModel, 
        input: [message] 
      };

      const embedHeaders = modelsConfigService.getProviderHeaders(actualEmbedProvider, embedKey);

      if (isEmulator) {
        console.log('🔍 Query Embedding Request:', JSON.stringify({
          provider: actualEmbedProvider,
          model: actualEmbedModel,
          url: embedApiUrl,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${embedKey.substring(0, 10)}...`,
            'Content-Type': 'application/json'
          },
          body: queryRequestBody
        }, null, 2));
      }

      const embResponse = await fetch(embedApiUrl, {
        method: 'POST',
        headers: embedHeaders,
        body: JSON.stringify(queryRequestBody)
      });

      if (!embResponse.ok) {
        throw new functions.https.HttpsError('internal', 'Failed to embed query');
      }

      const embJson = await embResponse.json() as any;
      const queryVector: number[] = embJson.data?.[0]?.embedding ?? [];

      if (isEmulator) {
        console.log(`📤 ${actualEmbedProvider} Query Embedding Response:`, JSON.stringify({
          status: embResponse.status,
          statusText: embResponse.statusText,
          data: {
            model: embJson.model,
            usage: embJson.usage,
            embeddingLength: queryVector.length
          }
        }, null, 2));
      }

      if (queryVector.length === 0) {
        throw new functions.https.HttpsError('internal', 'Empty query embedding');
      }

      // 2) Retrieve top-K chunks (brute-force similarity search)
      console.log(`Searching for chunks with uid: ${uid}, restrictDocId: ${restrictDocId}`);
      
      let chunksSnapshot;
      try {
        // Try simple query first if restrictDocId is provided
        if (restrictDocId) {
          console.log(`Trying compound query: uid=${uid}, docId=${restrictDocId}`);
          let chunksQuery = db.collectionGroup('chunks')
            .where('uid', '==', uid)
            .where('docId', '==', restrictDocId)
            .limit(5000);
          
          console.log('About to execute compound chunks query...');
          chunksSnapshot = await chunksQuery.get();
          console.log('Compound chunks query executed successfully');
        } else {
          console.log(`Trying simple query: uid=${uid}`);
          let chunksQuery = db.collectionGroup('chunks')
            .where('uid', '==', uid)
            .limit(5000);
          
          console.log('About to execute simple chunks query...');
          chunksSnapshot = await chunksQuery.get();
          console.log('Simple chunks query executed successfully');
        }
      } catch (queryError) {
        console.error('Error executing chunks query:', queryError);
        console.error('Query details:', { uid, restrictDocId });
        throw queryError;
      }
      
      if (chunksSnapshot.empty) {
        return { 
          answer: "I don't have any documents to search through. Please upload some PDF documents first." 
        };
      }

      const allChunks = chunksSnapshot.docs.map(doc => ({
        id: doc.id,
        ref: doc.ref,
        ...doc.data()
      }));

      console.log(`Found ${allChunks.length} chunks to search through`);

      // Calculate similarity scores and get top-K
      const scoredChunks = allChunks
        .map((chunk: any) => ({
          chunk,
          score: cosine(queryVector, chunk.embedding || [])
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

      if (scoredChunks.length === 0) {
        return { 
          answer: "I couldn't find any relevant information to answer your question." 
        };
      }

      // 3) Build context from top chunks
      const context = scoredChunks
        .map((item, index) => `[#${index + 1} p.${item.chunk.page}] ${item.chunk.text}`)
        .join('\n\n');

      const systemPrompt = `You are a helpful assistant that answers questions based on the provided context. Answer ONLY using information from the CONTEXT below. If the context doesn't contain enough information to answer the question, say so clearly. Be concise but thorough.`;

      const userPrompt = `CONTEXT:\n${context}\n\nQUESTION: ${message}`;

      // 4) Generate response with configurable LLM
      const llmApiKeyEnvVar = modelsConfigService.getApiKeyEnvVar(actualLlmProvider);
      const llmKey = process.env[llmApiKeyEnvVar];
      if (!llmKey) {
        console.error(`${llmApiKeyEnvVar} not found`);
        throw new functions.https.HttpsError('internal', `${llmApiKeyEnvVar} not configured`);
      }

      const llmApiUrl = modelsConfigService.getProviderApiUrl(actualLlmProvider, 'LLM');
      if (!llmApiUrl) {
        throw new functions.https.HttpsError('internal', `No API URL configured for provider ${actualLlmProvider} and model type LLM`);
      }

      const llmRequestBody = {
        model: actualLlmModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 1000
      };

      const llmHeaders = modelsConfigService.getProviderHeaders(actualLlmProvider, llmKey, 'rag');

      if (isEmulator) {
        console.log('🔍 LLM Request:', JSON.stringify({
          provider: actualLlmProvider,
          model: actualLlmModel,
          url: llmApiUrl,
          method: 'POST',
          headers: {
            ...modelsConfigService.getProviderHeaders(actualLlmProvider, `${llmKey.substring(0, 10)}...`, 'rag')
          },
          body: {
            ...llmRequestBody,
            messages: [
              { role: 'system', content: `${systemPrompt.substring(0, 100)}...` },
              { role: 'user', content: `${userPrompt.substring(0, 200)}...` }
            ]
          }
        }, null, 2));
      }

      const llmResponse = await fetch(llmApiUrl, {
        method: 'POST',
        headers: llmHeaders,
        body: JSON.stringify(llmRequestBody)
      });

      if (!llmResponse.ok) {
        const errorText = await llmResponse.text();
        console.error(`${actualLlmProvider} API error:`, llmResponse.status, errorText);
        throw new functions.https.HttpsError('internal', 'Failed to generate response');
      }

      const llmJson = await llmResponse.json() as any;
      const answer = llmJson.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response.';

      if (isEmulator) {
        console.log('📤 LLM Response:', JSON.stringify({
          provider: actualLlmProvider,
          model: actualLlmModel,
          status: llmResponse.status,
          statusText: llmResponse.statusText,
          data: {
            model: llmJson.model,
            usage: llmJson.usage,
            answerLength: answer.length,
            choicesCount: llmJson.choices?.length || 0
          }
        }, null, 2));
      }

      // 5) Prepare sources for frontend
      const sources = scoredChunks.map((item) => ({
        docId: item.chunk.docId,
        chunkId: item.chunk.id,
        page: item.chunk.page,
        score: Math.round(item.score * 1000) / 1000,
        label: `Page ${item.chunk.page} (${Math.round(item.score * 100)}% match)`
      }));

      console.log(`Successfully generated response with ${sources.length} sources`);

      return {
        answer,
        sources
      };

    } catch (error) {
      console.error('Error in chatRag:', error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError('internal', 'Failed to process chat request');
    }
  });

export const generalChat = functions
  .runWith({ timeoutSeconds: 60, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const { message, llmProvider, llmModel } = data;

    // Use provided models from UI - these should always be provided by the frontend
    // Fallback to config defaults only if UI doesn't provide them
    const defaults = modelsConfigService.getDefaultSelection('chat') as any;
    const actualLlmProvider = llmProvider || defaults?.llm?.provider || 'openrouter.ai';
    const actualLlmModel = llmModel || defaults?.llm?.model || 'openai/gpt-oss-20b:free';

    console.log('General chat request:', { actualLlmProvider, actualLlmModel });

    if (!message) {
      throw new functions.https.HttpsError('invalid-argument', 'message required');
    }

    try {
      // Get LLM API key
      const llmApiKeyEnvVar = modelsConfigService.getApiKeyEnvVar(actualLlmProvider);
      const llmKey = process.env[llmApiKeyEnvVar];
      if (!llmKey) {
        console.error(`${llmApiKeyEnvVar} not found`);
        throw new functions.https.HttpsError('internal', `${llmApiKeyEnvVar} not configured`);
      }

      const llmApiUrl = modelsConfigService.getProviderApiUrl(actualLlmProvider, 'LLM');
      if (!llmApiUrl) {
        throw new functions.https.HttpsError('internal', `No API URL configured for provider ${actualLlmProvider} and model type LLM`);
      }

      const llmRequestBody = {
        model: actualLlmModel,
        messages: [
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 2000
      };

      const llmHeaders = modelsConfigService.getProviderHeaders(actualLlmProvider, llmKey, 'chat');

      if (isEmulator) {
        console.log('🔍 General Chat LLM Request:', JSON.stringify({
          provider: actualLlmProvider,
          model: actualLlmModel,
          url: llmApiUrl,
          method: 'POST',
          headers: {
            ...modelsConfigService.getProviderHeaders(actualLlmProvider, `${llmKey.substring(0, 10)}...`, 'chat')
          },
          body: {
            ...llmRequestBody,
            messages: [{ role: 'user', content: `${message.substring(0, 100)}...` }]
          }
        }, null, 2));
      }

      const llmResponse = await fetch(llmApiUrl, {
        method: 'POST',
        headers: llmHeaders,
        body: JSON.stringify(llmRequestBody)
      });

      if (!llmResponse.ok) {
        const errorText = await llmResponse.text();
        console.error('LLM API error:', llmResponse.status, errorText);
        throw new functions.https.HttpsError('internal', 'Failed to generate response');
      }

      const llmJson = await llmResponse.json() as any;
      const answer = llmJson.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response.';

      if (isEmulator) {
        console.log('📤 General Chat LLM Response:', JSON.stringify({
          provider: actualLlmProvider,
          model: actualLlmModel,
          status: llmResponse.status,
          statusText: llmResponse.statusText,
          data: {
            model: llmJson.model,
            usage: llmJson.usage,
            answerLength: answer.length,
            choicesCount: llmJson.choices?.length || 0
          }
        }, null, 2));
      }

      console.log(`Successfully generated general chat response`);

      return { answer };

    } catch (error) {
      console.error('Error in generalChat:', error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError('internal', 'Failed to process general chat request');
    }
  });

export const visionChat = functions
  .runWith({ timeoutSeconds: 60, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const { message, imageData, visionProvider, visionModel } = data;

    // Use provided models from UI - these should always be provided by the frontend
    // Fallback to config defaults only if UI doesn't provide them
    const defaults = modelsConfigService.getDefaultSelection('vision') as any;
    const actualVisionProvider = visionProvider || defaults?.vision?.provider || 'openrouter.ai';
    const actualVisionModel = visionModel || defaults?.vision?.model || 'openai/gpt-4o';

    console.log('Vision chat request:', { actualVisionProvider, actualVisionModel });

    if (!message || !imageData) {
      throw new functions.https.HttpsError('invalid-argument', 'message and imageData required');
    }

    try {
      // Get Vision API key
      const visionApiKeyEnvVar = modelsConfigService.getApiKeyEnvVar(actualVisionProvider);
      const visionKey = process.env[visionApiKeyEnvVar];
      if (!visionKey) {
        console.error(`${visionApiKeyEnvVar} not found`);
        throw new functions.https.HttpsError('internal', `${visionApiKeyEnvVar} not configured`);
      }

      const visionApiUrl = modelsConfigService.getProviderApiUrl(actualVisionProvider, 'VISION');
      if (!visionApiUrl) {
        throw new functions.https.HttpsError('internal', `No API URL configured for provider ${actualVisionProvider} and model type VISION`);
      }

      // Build the message content with image
      const messageContent = [
        {
          type: 'text',
          text: message
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${imageData}`
          }
        }
      ];

      const visionRequestBody = {
        model: actualVisionModel,
        messages: [
          { role: 'user', content: messageContent }
        ],
        temperature: 0.7,
        max_tokens: 2000
      };

      const visionHeaders = modelsConfigService.getProviderHeaders(actualVisionProvider, visionKey, 'vision');

      if (isEmulator) {
        console.log('🔍 Vision Chat Request:', JSON.stringify({
          provider: actualVisionProvider,
          model: actualVisionModel,
          url: visionApiUrl,
          method: 'POST',
          headers: {
            ...modelsConfigService.getProviderHeaders(actualVisionProvider, `${visionKey.substring(0, 10)}...`, 'vision')
          },
          body: {
            ...visionRequestBody,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: `${message.substring(0, 100)}...` },
                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,[IMAGE_DATA]' } }
              ]
            }]
          }
        }, null, 2));
      }

      const visionResponse = await fetch(visionApiUrl, {
        method: 'POST',
        headers: visionHeaders,
        body: JSON.stringify(visionRequestBody)
      });

      if (!visionResponse.ok) {
        const errorText = await visionResponse.text();
        console.error('Vision API error:', visionResponse.status, errorText);
        throw new functions.https.HttpsError('internal', 'Failed to analyze image');
      }

      const visionJson = await visionResponse.json() as any;
      const answer = visionJson.choices?.[0]?.message?.content ?? 'Sorry, I could not analyze the image.';

      if (isEmulator) {
        console.log('📤 Vision Chat Response:', JSON.stringify({
          provider: actualVisionProvider,
          model: actualVisionModel,
          status: visionResponse.status,
          statusText: visionResponse.statusText,
          data: {
            model: visionJson.model,
            usage: visionJson.usage,
            answerLength: answer.length,
            choicesCount: visionJson.choices?.length || 0
          }
        }, null, 2));
      }

      console.log(`Successfully generated vision response`);

      return { answer };

    } catch (error) {
      console.error('Error in visionChat:', error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError('internal', 'Failed to process vision request');
    }
  });