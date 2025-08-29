import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import { modelsConfigService } from './models-config';

admin.initializeApp();
const db = admin.firestore();

const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

// OpenMeteo geocoding function
async function getCityCoordinates(cityName: string): Promise<{ lat: number; lon: number; name: string } | null> {
  try {
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1`;
    
    if (isEmulator) {
      console.log('🌍 Geocoding request:', geocodingUrl);
    }
    
    const response = await fetch(geocodingUrl);
    
    if (!response.ok) {
      console.error('Geocoding API error:', response.status, response.statusText);
      return null;
    }
    
    const data = await response.json() as any;
    const results = data.results;
    
    if (!results || results.length === 0) {
      console.log(`No geocoding results for city: ${cityName}`);
      return null;
    }
    
    const location = results[0];
    const coordinates = {
      lat: location.latitude,
      lon: location.longitude,
      name: location.name
    };
    
    if (isEmulator) {
      console.log('🌍 Geocoding result:', coordinates);
    }
    
    return coordinates;
  } catch (error) {
    console.error('Error in geocoding:', error);
    return null;
  }
}

async function getWeatherData(lat: number, lon: number): Promise<string> {
  try {
    if (isEmulator) {
      console.log('🌤️ Fetching weather data for coordinates:', { lat, lon });
    }

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
    
    const response = await fetch(weatherUrl);
    
    if (!response.ok) {
      console.error('Weather API error:', response.status, response.statusText);
      return 'Weather data unavailable';
    }
    
    const data = await response.json() as any;
    const current = data.current;
    
    if (!current) {
      console.error('No current weather data in response');
      return 'Weather data unavailable';
    }
    
    const temperature = Math.round(current.temperature_2m || 0);
    const humidity = Math.round(current.relative_humidity_2m || 0);
    const weatherCode = current.weather_code || 0;
    const windSpeed = Math.round(current.wind_speed_10m || 0);
    
    // WMO Weather interpretation codes
    let condition = 'Clear';
    if (weatherCode === 0) condition = 'Clear sky';
    else if (weatherCode <= 3) condition = 'Partly cloudy';
    else if (weatherCode <= 48) condition = 'Foggy';
    else if (weatherCode <= 57) condition = 'Drizzle';
    else if (weatherCode <= 67) condition = 'Rain';
    else if (weatherCode <= 77) condition = 'Snow';
    else if (weatherCode <= 82) condition = 'Rain showers';
    else if (weatherCode <= 86) condition = 'Snow showers';
    else if (weatherCode <= 99) condition = 'Thunderstorm';
    
    const weatherDescription = `${condition}, ${temperature}°C, ${humidity}% humidity, ${windSpeed} km/h wind`;
    
    if (isEmulator) {
      console.log('🌤️ Weather result:', { weatherCode, temperature, humidity, windSpeed, condition });
    }
    
    return weatherDescription;
  } catch (error) {
    console.error('Error fetching weather data:', error);
    return 'Weather data unavailable';
  }
}

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

      // Get session details to check for associated documents
      const sessionRef = db.collection('sessions').doc(sessionId);
      const sessionSnapshot = await sessionRef.get();
      
      if (!sessionSnapshot.exists) {
        throw new functions.https.HttpsError('not-found', 'Session not found');
      }

      const sessionData = sessionSnapshot.data();
      if (sessionData?.uid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Access denied');
      }

      const sessionDocuments = sessionData.associatedDocuments || [];
      console.log(`Session ${sessionId} has ${sessionDocuments.length} associated documents:`, sessionDocuments);

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
      console.log(`Using embedding model: ${actualEmbedProvider}/${actualEmbedModel}`);
      
      let chunksSnapshot;
      try {
        // Priority 1: If restrictDocId is provided, use only that document
        if (restrictDocId) {
          console.log(`Trying compound query: uid=${uid}, docId=${restrictDocId}`);
          let chunksQuery = db.collectionGroup('chunks')
            .where('uid', '==', uid)
            .where('docId', '==', restrictDocId)
            .limit(5000);
          
          console.log('About to execute compound chunks query...');
          chunksSnapshot = await chunksQuery.get();
          console.log('Compound chunks query executed successfully');
        }
        // Priority 2: If session has associated documents, use only those
        else if (sessionDocuments.length > 0) {
          console.log(`Using session-associated documents: ${sessionDocuments.join(', ')}`);
          
          // For multiple documents, we need to query each one separately and combine results
          const chunkPromises = sessionDocuments.map((docId: string) => 
            db.collectionGroup('chunks')
              .where('uid', '==', uid)
              .where('docId', '==', docId)
              .limit(1000)
              .get()
          );
          
          const chunkSnapshots = await Promise.all(chunkPromises);
          
          // Combine all chunks from all session documents
          const allDocs: any[] = [];
          chunkSnapshots.forEach(snapshot => {
            snapshot.docs.forEach((doc: any) => allDocs.push(doc));
          });
          
          // Create a fake snapshot object for compatibility
          chunksSnapshot = { 
            empty: allDocs.length === 0,
            docs: allDocs
          };
          
          console.log(`Found chunks from ${chunkSnapshots.length} session documents`);
        }
        // Priority 3: Fall back to all user documents (backward compatibility)
        else {
          console.log(`Trying simple query: uid=${uid} (all documents)`);
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

      console.log(`Found ${allChunks.length} chunks before filtering`);

      // Filter chunks to only include those with compatible embedding models
      const compatibleChunks = allChunks.filter((chunk: any) => {
        const chunkEmbedModel = chunk.embedModel;
        
        // If chunk doesn't have embedModel metadata, include it for backward compatibility
        if (!chunkEmbedModel) {
          console.log(`Including chunk ${chunk.id} (no embedModel metadata - backward compatibility)`);
          return true;
        }
        
        // Only include chunks that were embedded with the same model we're using for the query
        const isCompatible = chunkEmbedModel.provider === actualEmbedProvider && 
                             chunkEmbedModel.model === actualEmbedModel;
        
        if (!isCompatible) {
          console.log(`Excluding chunk ${chunk.id}: embedModel mismatch (chunk: ${chunkEmbedModel.provider}/${chunkEmbedModel.model}, query: ${actualEmbedProvider}/${actualEmbedModel})`);
        }
        
        return isCompatible;
      });

      console.log(`Found ${compatibleChunks.length} compatible chunks to search through`);

      // Calculate similarity scores and get top-K from compatible chunks
      const scoredChunks = compatibleChunks
        .map((chunk: any) => ({
          chunk,
          score: cosine(queryVector, chunk.embedding || [])
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

      if (scoredChunks.length === 0) {
        if (allChunks.length > 0) {
          return { 
            answer: `I found ${allChunks.length} document chunks, but none were embedded with the same model you're currently using (${actualEmbedProvider}/${actualEmbedModel}). Please re-upload your documents or switch to a compatible embedding model.` 
          };
        }
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

export const deleteDocument = functions
  .runWith({ timeoutSeconds: 60, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const { docId } = data;
    
    if (!docId) {
      throw new functions.https.HttpsError('invalid-argument', 'docId required');
    }

    const uid = context.auth.uid;

    try {
      console.log(`Deleting document ${docId} for user ${uid}`);

      // 1) Verify document belongs to user
      const docRef = db.collection('documents').doc(docId);
      const docSnapshot = await docRef.get();
      
      if (!docSnapshot.exists) {
        throw new functions.https.HttpsError('not-found', 'Document not found');
      }

      const docData = docSnapshot.data();
      if (docData?.uid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Access denied');
      }

      console.log(`Document verified: ${docData.filename}`);

      // 2) Delete all chunks
      const chunksQuery = db.collection(`documents/${docId}/chunks`);
      const chunksSnapshot = await chunksQuery.get();
      
      console.log(`Found ${chunksSnapshot.docs.length} chunks to delete`);
      
      const chunkDeletions = chunksSnapshot.docs.map(chunkDoc => chunkDoc.ref.delete());
      await Promise.all(chunkDeletions);

      console.log('All chunks deleted');

      // 3) Delete the file from Storage (if bucketPath exists)
      if (docData.bucketPath) {
        try {
          const bucket = admin.storage().bucket();
          await bucket.file(docData.bucketPath).delete();
          console.log(`Storage file deleted: ${docData.bucketPath}`);
        } catch (storageError) {
          console.warn('Failed to delete storage file (may not exist):', storageError);
          // Continue with deletion even if storage file doesn't exist
        }
      }

      // 4) Remove document from all sessions that reference it
      const sessionsQuery = db.collection('sessions')
        .where('uid', '==', uid)
        .where('associatedDocuments', 'array-contains', docId);
      
      const sessionsSnapshot = await sessionsQuery.get();
      
      if (!sessionsSnapshot.empty) {
        console.log(`Removing document from ${sessionsSnapshot.docs.length} sessions`);
        
        const sessionUpdates = sessionsSnapshot.docs.map(sessionDoc => {
          const sessionData = sessionDoc.data();
          const updatedDocs = (sessionData.associatedDocuments || []).filter((id: string) => id !== docId);
          return sessionDoc.ref.update({ associatedDocuments: updatedDocs });
        });
        
        await Promise.all(sessionUpdates);
      }

      // 5) Delete the document record
      await docRef.delete();

      console.log(`Document ${docId} completely deleted`);

      return { success: true };

    } catch (error) {
      console.error('Error in deleteDocument:', error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError('internal', 'Failed to delete document');
    }
  });

export const deleteSession = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const { sessionId } = data;
    
    if (!sessionId) {
      throw new functions.https.HttpsError('invalid-argument', 'sessionId required');
    }

    const uid = context.auth.uid;

    try {
      console.log(`Deleting session ${sessionId} for user ${uid}`);

      // 1) Verify session belongs to user
      const sessionRef = db.collection('sessions').doc(sessionId);
      const sessionSnapshot = await sessionRef.get();
      
      if (!sessionSnapshot.exists) {
        throw new functions.https.HttpsError('not-found', 'Session not found');
      }

      const sessionData = sessionSnapshot.data();
      if (sessionData?.uid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Access denied');
      }

      console.log(`Session verified: ${sessionData.title}`);

      // 2) Get associated documents
      const associatedDocuments = sessionData.associatedDocuments || [];
      console.log(`Found ${associatedDocuments.length} associated documents`);

      // 3) Delete all associated documents (and their chunks/files)
      for (const docId of associatedDocuments) {
        try {
          console.log(`Deleting associated document: ${docId}`);
          
          // Get document data
          const docRef = db.collection('documents').doc(docId);
          const docSnapshot = await docRef.get();
          
          if (!docSnapshot.exists) {
            console.warn(`Document ${docId} not found, skipping`);
            continue;
          }

          const docData = docSnapshot.data();
          if (docData?.uid !== uid) {
            console.warn(`Document ${docId} doesn't belong to user, skipping`);
            continue;
          }

          // Delete chunks
          const chunksQuery = db.collection(`documents/${docId}/chunks`);
          const chunksSnapshot = await chunksQuery.get();
          const chunkDeletions = chunksSnapshot.docs.map(chunkDoc => chunkDoc.ref.delete());
          await Promise.all(chunkDeletions);
          
          console.log(`Deleted ${chunksSnapshot.docs.length} chunks for document ${docId}`);

          // Delete storage file
          if (docData.bucketPath) {
            try {
              const bucket = admin.storage().bucket();
              await bucket.file(docData.bucketPath).delete();
              console.log(`Storage file deleted: ${docData.bucketPath}`);
            } catch (storageError) {
              console.warn('Failed to delete storage file:', storageError);
            }
          }

          // Delete document record
          await docRef.delete();
          console.log(`Document ${docId} deleted`);
          
        } catch (docError) {
          console.error(`Error deleting document ${docId}:`, docError);
          // Continue with other documents even if one fails
        }
      }

      // 4) Delete all session messages
      const messagesQuery = db.collection(`sessions/${sessionId}/messages`);
      const messagesSnapshot = await messagesQuery.get();
      
      console.log(`Found ${messagesSnapshot.docs.length} messages to delete`);
      
      const messageDeletions = messagesSnapshot.docs.map(messageDoc => messageDoc.ref.delete());
      await Promise.all(messageDeletions);

      console.log('All messages deleted');

      // 5) Delete the session record
      await sessionRef.delete();

      console.log(`Session ${sessionId} completely deleted`);

      return { success: true };

    } catch (error) {
      console.error('Error in deleteSession:', error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError('internal', 'Failed to delete session');
    }
  });

// MCP Weather Server (SSE-based for web clients)
export const mcpWeatherServer = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
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

    console.log(`MCP Weather Server: ${req.method} ${req.url}`);

    try {
      // Handle MCP protocol initialization
      if (req.method === 'POST' && req.url === '/initialize') {
        const initResponse = {
          jsonrpc: '2.0',
          id: req.body?.id || 1,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'weather-server',
              version: '1.0.0'
            }
          }
        };

        res.json(initResponse);
        return;
      }

      // Handle tools list request
      if (req.method === 'POST' && req.url === '/tools/list') {
        const toolsResponse = {
          jsonrpc: '2.0',
          id: req.body?.id || 1,
          result: {
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
          }
        };

        res.json(toolsResponse);
        return;
      }

      // Handle tool execution
      if (req.method === 'POST' && req.url === '/tools/call') {
        const { id, params } = req.body || {};
        const { name, arguments: toolArgs } = params || {};

        if (name === 'get_weather') {
          const city = toolArgs?.city || '';
          
          if (!city) {
            const errorResponse = {
              jsonrpc: '2.0',
              id: id || 1,
              error: {
                code: -32602,
                message: 'City parameter is required'
              }
            };
            res.json(errorResponse);
            return;
          }

          try {
            // Get coordinates for the city
            const coordinates = await getCityCoordinates(city);
            
            if (!coordinates) {
              const callResponse = {
                jsonrpc: '2.0',
                id: id || 1,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `Sorry, I couldn't find coordinates for "${city}". Please try a major city name.`
                    }
                  ]
                }
              };
              res.json(callResponse);
              return;
            }

            // Get weather data
            const weather = await getWeatherData(coordinates.lat, coordinates.lon);
            
            const callResponse = {
              jsonrpc: '2.0',
              id: id || 1,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `The weather in ${coordinates.name} is: ${weather}`
                  }
                ]
              }
            };

            res.json(callResponse);
            return;

          } catch (error) {
            console.error('Error getting weather:', error);
            const errorResponse = {
              jsonrpc: '2.0',
              id: id || 1,
              error: {
                code: -32603,
                message: 'Failed to get weather data'
              }
            };
            res.json(errorResponse);
            return;
          }
        }

        // Unknown tool
        const errorResponse = {
          jsonrpc: '2.0',
          id: id || 1,
          error: {
            code: -32601,
            message: `Unknown tool: ${name}`
          }
        };

        res.json(errorResponse);
        return;
      }

      // SSE endpoint for real-time communication (for Angular UI)
      if (req.method === 'GET' && req.url === '/events') {
        res.set('Content-Type', 'text/event-stream');
        
        // Send initial connection message
        const welcomeMessage = {
          type: 'server_info',
          data: {
            name: 'MCP Weather Server',
            version: '1.0.0',
            capabilities: ['tools'],
            endpoint: 'weather'
          }
        };

        res.write(`data: ${JSON.stringify(welcomeMessage)}\n\n`);

        // Keep connection alive with heartbeat
        const heartbeat = setInterval(() => {
          res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
        }, 30000);

        // Clean up on client disconnect
        req.on('close', () => {
          clearInterval(heartbeat);
          console.log('MCP SSE client disconnected');
        });

        return;
      }

      // Server info endpoint
      if (req.method === 'GET') {
        res.json({
          name: 'MCP Weather Server',
          version: '1.0.0',
          protocol: 'MCP/2024-11-05',
          capabilities: ['tools'],
          endpoints: {
            initialize: 'POST /initialize',
            tools_list: 'POST /tools/list',
            tools_call: 'POST /tools/call',
            events: 'GET /events'
          }
        });
        return;
      }

      // Method not supported
      res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
      console.error('Error in MCP Weather Server:', error);
      
      const errorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32603,
          message: 'Internal error',
          data: isEmulator ? (error instanceof Error ? error.message : String(error)) : 'Server error'
        }
      };

      res.json(errorResponse);
    }
  });