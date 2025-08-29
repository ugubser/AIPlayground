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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mcpWeatherServer = exports.deleteSession = exports.deleteDocument = exports.visionChat = exports.mcpChat = exports.generalChat = exports.chatRag = exports.embedChunks = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const models_config_1 = require("./models-config");
const function_constants_1 = require("./config/function-constants");
const logger_1 = require("./utils/logger");
admin.initializeApp();
const db = admin.firestore();
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
// Helper function to handle LLM API errors with specific messaging
function handleLlmApiError(status, errorText, provider) {
    var _a, _b, _c;
    logger_1.logger.error('LLM API Error', { provider, status, errorText });
    if (status === 429 && provider === 'openrouter.ai') {
        // Check if it's a rate limit error
        try {
            const errorData = JSON.parse(errorText);
            if ((_c = (_b = (_a = errorData.error) === null || _a === void 0 ? void 0 : _a.metadata) === null || _b === void 0 ? void 0 : _b.raw) === null || _c === void 0 ? void 0 : _c.includes('rate-limited upstream')) {
                throw new functions.https.HttpsError('resource-exhausted', 'This model is rate limited, please choose a different model');
            }
        }
        catch (parseError) {
            // If we can't parse the error, check if the text contains rate limit indicators
            if (errorText.includes('rate-limited') || errorText.includes('rate limit')) {
                throw new functions.https.HttpsError('resource-exhausted', 'This model is rate limited, please choose a different model');
            }
        }
    }
    // Default error message for other errors
    throw new functions.https.HttpsError('internal', 'Failed to generate response');
}
// OpenMeteo geocoding function
async function getCityCoordinates(cityName) {
    try {
        const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1`;
        if (isEmulator) {
            console.log('🌍 Geocoding request:', geocodingUrl);
        }
        const response = await (0, node_fetch_1.default)(geocodingUrl);
        if (!response.ok) {
            console.error('Geocoding API error:', response.status, response.statusText);
            return null;
        }
        const data = await response.json();
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
    }
    catch (error) {
        console.error('Error in geocoding:', error);
        return null;
    }
}
function interpretWeatherCode(weatherCode) {
    if (weatherCode === 0)
        return 'Clear sky';
    else if (weatherCode <= 3)
        return 'Partly cloudy';
    else if (weatherCode <= 48)
        return 'Foggy';
    else if (weatherCode <= 57)
        return 'Drizzle';
    else if (weatherCode <= 67)
        return 'Rain';
    else if (weatherCode <= 77)
        return 'Snow';
    else if (weatherCode <= 82)
        return 'Rain showers';
    else if (weatherCode <= 86)
        return 'Snow showers';
    else if (weatherCode <= 99)
        return 'Thunderstorm';
    return 'Clear';
}
async function getWeatherData(lat, lon) {
    try {
        if (isEmulator) {
            console.log('🌤️ Fetching current weather for coordinates:', { lat, lon });
        }
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
        const response = await (0, node_fetch_1.default)(weatherUrl);
        if (!response.ok) {
            console.error('Weather API error:', response.status, response.statusText);
            return 'Weather data unavailable';
        }
        const data = await response.json();
        const current = data.current;
        if (!current) {
            console.error('No current weather data in response');
            return 'Weather data unavailable';
        }
        const temperature = Math.round(current.temperature_2m || 0);
        const humidity = Math.round(current.relative_humidity_2m || 0);
        const weatherCode = current.weather_code || 0;
        const windSpeed = Math.round(current.wind_speed_10m || 0);
        const condition = interpretWeatherCode(weatherCode);
        const weatherDescription = `${condition}, ${temperature}°C, ${humidity}% humidity, ${windSpeed} km/h wind`;
        if (isEmulator) {
            console.log('🌤️ Current weather result:', { weatherCode, temperature, humidity, windSpeed, condition });
        }
        return weatherDescription;
    }
    catch (error) {
        console.error('Error fetching weather data:', error);
        return 'Weather data unavailable';
    }
}
async function getForecastData(lat, lon) {
    try {
        if (isEmulator) {
            console.log('🌤️ Fetching 7-day forecast for coordinates:', { lat, lon });
        }
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=7`;
        const response = await (0, node_fetch_1.default)(forecastUrl);
        if (!response.ok) {
            console.error('Forecast API error:', response.status, response.statusText);
            return 'Forecast data unavailable';
        }
        const data = await response.json();
        const daily = data.daily;
        if (!daily || !daily.time) {
            console.error('No daily forecast data in response');
            return 'Forecast data unavailable';
        }
        const forecastLines = [];
        for (let i = 0; i < Math.min(7, daily.time.length); i++) {
            const date = new Date(daily.time[i]).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric'
            });
            const maxTemp = Math.round(daily.temperature_2m_max[i] || 0);
            const minTemp = Math.round(daily.temperature_2m_min[i] || 0);
            const weatherCode = daily.weather_code[i] || 0;
            const precipitation = Math.round((daily.precipitation_sum[i] || 0) * 10) / 10;
            const condition = interpretWeatherCode(weatherCode);
            let line = `${date}: ${condition}, ${maxTemp}°/${minTemp}°C`;
            if (precipitation > 0) {
                line += `, ${precipitation}mm rain`;
            }
            forecastLines.push(line);
        }
        const forecastDescription = '7-day forecast:\n' + forecastLines.join('\n');
        if (isEmulator) {
            console.log('🌤️ Forecast result:', forecastLines.length, 'days');
        }
        return forecastDescription;
    }
    catch (error) {
        console.error('Error fetching forecast data:', error);
        return 'Forecast data unavailable';
    }
}
function cosine(a, b) {
    if (a.length !== b.length)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
exports.embedChunks = functions
    .runWith({ timeoutSeconds: function_constants_1.FUNCTION_CONSTANTS.TIMEOUTS.EMBED_CHUNKS, memory: function_constants_1.FUNCTION_CONSTANTS.MEMORY.LARGE })
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }
    const { texts, provider = function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.EMBED_PROVIDER, model = function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.EMBED_MODEL } = data;
    if (!Array.isArray(texts) || texts.length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'texts array required');
    }
    if (texts.length > function_constants_1.FUNCTION_CONSTANTS.BATCH_LIMITS.MAX_TEXTS_PER_BATCH) {
        throw new functions.https.HttpsError('invalid-argument', `Maximum ${function_constants_1.FUNCTION_CONSTANTS.BATCH_LIMITS.MAX_TEXTS_PER_BATCH} texts per batch`);
    }
    // Validate provider supports embeddings
    if (!models_config_1.modelsConfigService.supportsEmbeddings(provider)) {
        throw new functions.https.HttpsError('invalid-argument', `Provider ${provider} does not support embeddings`);
    }
    // Get API key based on provider
    const apiKeyEnvVar = models_config_1.modelsConfigService.getApiKeyEnvVar(provider);
    const key = process.env[apiKeyEnvVar];
    if (!key) {
        console.error(`${apiKeyEnvVar} not found in environment`);
        throw new functions.https.HttpsError('internal', `${apiKeyEnvVar} not configured`);
    }
    console.log(`${apiKeyEnvVar} found:`, !!key);
    // Get API URL based on provider
    const apiUrl = models_config_1.modelsConfigService.getProviderApiUrl(provider, 'EMBED');
    if (!apiUrl) {
        throw new functions.https.HttpsError('internal', `No API URL configured for provider ${provider} and model type EMBED`);
    }
    try {
        console.log(`Processing ${texts.length} texts for embeddings using ${provider}/${model}`);
        const requestBody = {
            model,
            input: texts
        };
        const headers = models_config_1.modelsConfigService.getProviderHeaders(provider, key);
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
        const response = await (0, node_fetch_1.default)(apiUrl, {
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
        const json = await response.json();
        const vectors = (json.data || []).map((d) => d.embedding);
        if (isEmulator) {
            console.log(`📤 ${provider} Response:`, JSON.stringify({
                status: response.status,
                statusText: response.statusText,
                data: {
                    model: json.model,
                    usage: json.usage,
                    vectorCount: vectors.length,
                    firstVectorLength: ((_a = vectors[0]) === null || _a === void 0 ? void 0 : _a.length) || 0
                }
            }, null, 2));
        }
        if (vectors.length !== texts.length) {
            throw new functions.https.HttpsError('internal', 'Mismatch between input and output lengths');
        }
        console.log(`Successfully generated ${vectors.length} embeddings`);
        return { vectors };
    }
    catch (error) {
        console.error('Error in embedChunks:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to generate embeddings');
    }
});
exports.chatRag = functions
    .runWith({ timeoutSeconds: function_constants_1.FUNCTION_CONSTANTS.TIMEOUTS.CHAT_RAG, memory: function_constants_1.FUNCTION_CONSTANTS.MEMORY.SMALL })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }
    const { sessionId, message, k = function_constants_1.FUNCTION_CONSTANTS.BATCH_LIMITS.DEFAULT_TOP_K, restrictDocId, llmProvider, llmModel, embedProvider, embedModel } = data;
    // Use provided models from UI - these should always be provided by the frontend
    // Fallback to config defaults only if UI doesn't provide them
    const defaults = models_config_1.modelsConfigService.getDefaultSelection('rag');
    const actualLlmProvider = llmProvider || ((_a = defaults === null || defaults === void 0 ? void 0 : defaults.llm) === null || _a === void 0 ? void 0 : _a.provider) || function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.LLM_PROVIDER;
    const actualLlmModel = llmModel || ((_b = defaults === null || defaults === void 0 ? void 0 : defaults.llm) === null || _b === void 0 ? void 0 : _b.model) || function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.LLM_MODEL;
    const actualEmbedProvider = embedProvider || ((_c = defaults === null || defaults === void 0 ? void 0 : defaults.embed) === null || _c === void 0 ? void 0 : _c.provider) || function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.EMBED_PROVIDER;
    const actualEmbedModel = embedModel || ((_d = defaults === null || defaults === void 0 ? void 0 : defaults.embed) === null || _d === void 0 ? void 0 : _d.model) || function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.EMBED_MODEL;
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
        if ((sessionData === null || sessionData === void 0 ? void 0 : sessionData.uid) !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Access denied');
        }
        const sessionDocuments = sessionData.associatedDocuments || [];
        console.log(`Session ${sessionId} has ${sessionDocuments.length} associated documents:`, sessionDocuments);
        // 1) Embed the query
        // Validate embed provider supports embeddings
        if (!models_config_1.modelsConfigService.supportsEmbeddings(actualEmbedProvider)) {
            throw new functions.https.HttpsError('invalid-argument', `Provider ${actualEmbedProvider} does not support embeddings`);
        }
        const embedApiKeyEnvVar = models_config_1.modelsConfigService.getApiKeyEnvVar(actualEmbedProvider);
        const embedKey = process.env[embedApiKeyEnvVar];
        if (!embedKey) {
            console.error(`${embedApiKeyEnvVar} not found for embedding`);
            throw new functions.https.HttpsError('internal', `${embedApiKeyEnvVar} not configured`);
        }
        const embedApiUrl = models_config_1.modelsConfigService.getProviderApiUrl(actualEmbedProvider, 'EMBED');
        if (!embedApiUrl) {
            throw new functions.https.HttpsError('internal', `No API URL configured for provider ${actualEmbedProvider} and model type EMBED`);
        }
        const queryRequestBody = {
            model: actualEmbedModel,
            input: [message]
        };
        const embedHeaders = models_config_1.modelsConfigService.getProviderHeaders(actualEmbedProvider, embedKey);
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
        const embResponse = await (0, node_fetch_1.default)(embedApiUrl, {
            method: 'POST',
            headers: embedHeaders,
            body: JSON.stringify(queryRequestBody)
        });
        if (!embResponse.ok) {
            throw new functions.https.HttpsError('internal', 'Failed to embed query');
        }
        const embJson = await embResponse.json();
        const queryVector = (_g = (_f = (_e = embJson.data) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.embedding) !== null && _g !== void 0 ? _g : [];
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
                    .limit(function_constants_1.FUNCTION_CONSTANTS.BATCH_LIMITS.MAX_CHUNKS_QUERY);
                console.log('About to execute compound chunks query...');
                chunksSnapshot = await chunksQuery.get();
                console.log('Compound chunks query executed successfully');
            }
            // Priority 2: If session has associated documents, use only those
            else if (sessionDocuments.length > 0) {
                console.log(`Using session-associated documents: ${sessionDocuments.join(', ')}`);
                // For multiple documents, we need to query each one separately and combine results
                const chunkPromises = sessionDocuments.map((docId) => db.collectionGroup('chunks')
                    .where('uid', '==', uid)
                    .where('docId', '==', docId)
                    .limit(function_constants_1.FUNCTION_CONSTANTS.BATCH_LIMITS.MAX_SESSION_DOCS_QUERY)
                    .get());
                const chunkSnapshots = await Promise.all(chunkPromises);
                // Combine all chunks from all session documents
                const allDocs = [];
                chunkSnapshots.forEach(snapshot => {
                    snapshot.docs.forEach((doc) => allDocs.push(doc));
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
                    .limit(function_constants_1.FUNCTION_CONSTANTS.BATCH_LIMITS.MAX_CHUNKS_QUERY);
                console.log('About to execute simple chunks query...');
                chunksSnapshot = await chunksQuery.get();
                console.log('Simple chunks query executed successfully');
            }
        }
        catch (queryError) {
            console.error('Error executing chunks query:', queryError);
            console.error('Query details:', { uid, restrictDocId });
            throw queryError;
        }
        if (chunksSnapshot.empty) {
            return {
                answer: "I don't have any documents to search through. Please upload some PDF documents first."
            };
        }
        const allChunks = chunksSnapshot.docs.map(doc => (Object.assign({ id: doc.id, ref: doc.ref }, doc.data())));
        console.log(`Found ${allChunks.length} chunks before filtering`);
        // Filter chunks to only include those with compatible embedding models
        const compatibleChunks = allChunks.filter((chunk) => {
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
            .map((chunk) => ({
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
        const llmApiKeyEnvVar = models_config_1.modelsConfigService.getApiKeyEnvVar(actualLlmProvider);
        const llmKey = process.env[llmApiKeyEnvVar];
        if (!llmKey) {
            console.error(`${llmApiKeyEnvVar} not found`);
            throw new functions.https.HttpsError('internal', `${llmApiKeyEnvVar} not configured`);
        }
        const llmApiUrl = models_config_1.modelsConfigService.getProviderApiUrl(actualLlmProvider, 'LLM');
        if (!llmApiUrl) {
            throw new functions.https.HttpsError('internal', `No API URL configured for provider ${actualLlmProvider} and model type LLM`);
        }
        const llmRequestBody = {
            model: actualLlmModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: function_constants_1.FUNCTION_CONSTANTS.LLM_CONFIG.RAG_TEMPERATURE,
            max_tokens: function_constants_1.FUNCTION_CONSTANTS.LLM_CONFIG.RAG_MAX_TOKENS
        };
        const llmHeaders = models_config_1.modelsConfigService.getProviderHeaders(actualLlmProvider, llmKey, 'rag');
        if (isEmulator) {
            console.log('🔍 LLM Request:', JSON.stringify({
                provider: actualLlmProvider,
                model: actualLlmModel,
                url: llmApiUrl,
                method: 'POST',
                headers: Object.assign({}, models_config_1.modelsConfigService.getProviderHeaders(actualLlmProvider, `${llmKey.substring(0, 10)}...`, 'rag')),
                body: Object.assign(Object.assign({}, llmRequestBody), { messages: [
                        { role: 'system', content: `${systemPrompt.substring(0, 100)}...` },
                        { role: 'user', content: `${userPrompt.substring(0, 200)}...` }
                    ] })
            }, null, 2));
        }
        const llmResponse = await (0, node_fetch_1.default)(llmApiUrl, {
            method: 'POST',
            headers: llmHeaders,
            body: JSON.stringify(llmRequestBody)
        });
        if (!llmResponse.ok) {
            const errorText = await llmResponse.text();
            handleLlmApiError(llmResponse.status, errorText, actualLlmProvider);
        }
        const llmJson = await llmResponse.json();
        const answer = (_l = (_k = (_j = (_h = llmJson.choices) === null || _h === void 0 ? void 0 : _h[0]) === null || _j === void 0 ? void 0 : _j.message) === null || _k === void 0 ? void 0 : _k.content) !== null && _l !== void 0 ? _l : 'Sorry, I could not generate a response.';
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
                    choicesCount: ((_m = llmJson.choices) === null || _m === void 0 ? void 0 : _m.length) || 0
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
    }
    catch (error) {
        console.error('Error in chatRag:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to process chat request');
    }
});
exports.generalChat = functions
    .runWith({ timeoutSeconds: function_constants_1.FUNCTION_CONSTANTS.TIMEOUTS.GENERAL_CHAT, memory: function_constants_1.FUNCTION_CONSTANTS.MEMORY.SMALL })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }
    const { message, llmProvider, llmModel } = data;
    // Use provided models from UI - these should always be provided by the frontend
    // Fallback to config defaults only if UI doesn't provide them
    const defaults = models_config_1.modelsConfigService.getDefaultSelection('chat');
    const actualLlmProvider = llmProvider || ((_a = defaults === null || defaults === void 0 ? void 0 : defaults.llm) === null || _a === void 0 ? void 0 : _a.provider) || function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.LLM_PROVIDER;
    const actualLlmModel = llmModel || ((_b = defaults === null || defaults === void 0 ? void 0 : defaults.llm) === null || _b === void 0 ? void 0 : _b.model) || function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.LLM_MODEL;
    console.log('General chat request:', { actualLlmProvider, actualLlmModel });
    if (!message) {
        throw new functions.https.HttpsError('invalid-argument', 'message required');
    }
    try {
        // Get LLM API key
        const llmApiKeyEnvVar = models_config_1.modelsConfigService.getApiKeyEnvVar(actualLlmProvider);
        const llmKey = process.env[llmApiKeyEnvVar];
        if (!llmKey) {
            console.error(`${llmApiKeyEnvVar} not found`);
            throw new functions.https.HttpsError('internal', `${llmApiKeyEnvVar} not configured`);
        }
        const llmApiUrl = models_config_1.modelsConfigService.getProviderApiUrl(actualLlmProvider, 'LLM');
        if (!llmApiUrl) {
            throw new functions.https.HttpsError('internal', `No API URL configured for provider ${actualLlmProvider} and model type LLM`);
        }
        const llmRequestBody = {
            model: actualLlmModel,
            messages: [
                { role: 'user', content: message }
            ],
            temperature: function_constants_1.FUNCTION_CONSTANTS.LLM_CONFIG.CHAT_TEMPERATURE,
            max_tokens: function_constants_1.FUNCTION_CONSTANTS.LLM_CONFIG.CHAT_MAX_TOKENS
        };
        const llmHeaders = models_config_1.modelsConfigService.getProviderHeaders(actualLlmProvider, llmKey, 'chat');
        if (isEmulator) {
            console.log('🔍 General Chat LLM Request:', JSON.stringify({
                provider: actualLlmProvider,
                model: actualLlmModel,
                url: llmApiUrl,
                method: 'POST',
                headers: Object.assign({}, models_config_1.modelsConfigService.getProviderHeaders(actualLlmProvider, `${llmKey.substring(0, 10)}...`, 'chat')),
                body: Object.assign(Object.assign({}, llmRequestBody), { messages: [{ role: 'user', content: `${message.substring(0, 100)}...` }] })
            }, null, 2));
        }
        const llmResponse = await (0, node_fetch_1.default)(llmApiUrl, {
            method: 'POST',
            headers: llmHeaders,
            body: JSON.stringify(llmRequestBody)
        });
        if (!llmResponse.ok) {
            const errorText = await llmResponse.text();
            handleLlmApiError(llmResponse.status, errorText, actualLlmProvider);
        }
        const llmJson = await llmResponse.json();
        const answer = (_f = (_e = (_d = (_c = llmJson.choices) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.message) === null || _e === void 0 ? void 0 : _e.content) !== null && _f !== void 0 ? _f : 'Sorry, I could not generate a response.';
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
                    choicesCount: ((_g = llmJson.choices) === null || _g === void 0 ? void 0 : _g.length) || 0
                }
            }, null, 2));
        }
        console.log(`Successfully generated general chat response`);
        return { answer };
    }
    catch (error) {
        console.error('Error in generalChat:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to process general chat request');
    }
});
exports.mcpChat = functions
    .runWith({ timeoutSeconds: function_constants_1.FUNCTION_CONSTANTS.TIMEOUTS.MCP_CHAT, memory: function_constants_1.FUNCTION_CONSTANTS.MEMORY.SMALL })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }
    const { message, llmProvider, llmModel, tools, toolResults } = data;
    // Use provided models from UI
    const defaults = models_config_1.modelsConfigService.getDefaultSelection('chat');
    const actualLlmProvider = llmProvider || ((_a = defaults === null || defaults === void 0 ? void 0 : defaults.llm) === null || _a === void 0 ? void 0 : _a.provider) || function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.LLM_PROVIDER;
    const actualLlmModel = llmModel || ((_b = defaults === null || defaults === void 0 ? void 0 : defaults.llm) === null || _b === void 0 ? void 0 : _b.model) || function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.MCP_MODEL;
    console.log('MCP Chat request:', {
        actualLlmProvider,
        actualLlmModel,
        toolsCount: (tools === null || tools === void 0 ? void 0 : tools.length) || 0,
        hasToolResults: !!(toolResults === null || toolResults === void 0 ? void 0 : toolResults.length)
    });
    if (!message) {
        throw new functions.https.HttpsError('invalid-argument', 'message required');
    }
    try {
        // Get LLM API key
        const llmApiKeyEnvVar = models_config_1.modelsConfigService.getApiKeyEnvVar(actualLlmProvider);
        const llmKey = process.env[llmApiKeyEnvVar];
        if (!llmKey) {
            console.error(`${llmApiKeyEnvVar} not found`);
            throw new functions.https.HttpsError('internal', `${llmApiKeyEnvVar} not configured`);
        }
        const llmApiUrl = models_config_1.modelsConfigService.getProviderApiUrl(actualLlmProvider, 'LLM');
        if (!llmApiUrl) {
            throw new functions.https.HttpsError('internal', `No API URL configured for provider ${actualLlmProvider}`);
        }
        // Build conversation with tool results if provided
        const messages = [{ role: 'user', content: message }];
        // If we have tool results, this is a follow-up call after tool execution
        if (toolResults && toolResults.length > 0) {
            // Add the assistant's tool calls
            messages.push({
                role: 'assistant',
                tool_calls: toolResults.map((result) => ({
                    id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: 'function',
                    function: {
                        name: result.toolName,
                        arguments: JSON.stringify(result.arguments)
                    }
                }))
            });
            // Add tool results
            toolResults.forEach((result) => {
                messages.push({
                    role: 'tool',
                    tool_call_id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: result.toolName,
                    content: result.result
                });
            });
        }
        // Prepare request body
        const llmRequestBody = {
            model: actualLlmModel,
            messages: messages,
            temperature: function_constants_1.FUNCTION_CONSTANTS.LLM_CONFIG.CHAT_TEMPERATURE,
            max_tokens: function_constants_1.FUNCTION_CONSTANTS.LLM_CONFIG.CHAT_MAX_TOKENS
        };
        // Add tools for supported providers (only on initial request)
        if (tools && tools.length > 0 && !toolResults) {
            if (actualLlmProvider === 'openrouter.ai') {
                llmRequestBody.tools = tools.map((tool) => ({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema
                    }
                }));
                llmRequestBody.tool_choice = 'auto';
            }
            else if (actualLlmProvider === 'together.ai') {
                llmRequestBody.tools = tools.map((tool) => ({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema
                    }
                }));
                llmRequestBody.tool_choice = 'auto';
            }
        }
        const llmHeaders = models_config_1.modelsConfigService.getProviderHeaders(actualLlmProvider, llmKey, 'chat');
        if (isEmulator) {
            console.log('🔍 MCP Chat LLM Request:', JSON.stringify({
                provider: actualLlmProvider,
                model: actualLlmModel,
                url: llmApiUrl,
                hasTools: !!(tools === null || tools === void 0 ? void 0 : tools.length) && !toolResults,
                toolCount: (tools === null || tools === void 0 ? void 0 : tools.length) || 0,
                messageCount: messages.length,
                isFollowUp: !!toolResults
            }, null, 2));
        }
        const llmResponse = await (0, node_fetch_1.default)(llmApiUrl, {
            method: 'POST',
            headers: llmHeaders,
            body: JSON.stringify(llmRequestBody)
        });
        if (!llmResponse.ok) {
            const errorText = await llmResponse.text();
            handleLlmApiError(llmResponse.status, errorText, actualLlmProvider);
        }
        const llmJson = await llmResponse.json();
        const choice = (_c = llmJson.choices) === null || _c === void 0 ? void 0 : _c[0];
        if (!choice) {
            throw new functions.https.HttpsError('internal', 'No response from LLM');
        }
        const message_content = choice.message;
        // Check if LLM wants to use tools (only on initial request)
        if (!toolResults && message_content.tool_calls && message_content.tool_calls.length > 0) {
            const toolCalls = message_content.tool_calls.map((tc) => ({
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                    ? JSON.parse(tc.function.arguments)
                    : tc.function.arguments
            }));
            return {
                answer: message_content.content || 'I need to use some tools to answer your question.',
                toolCalls: toolCalls
            };
        }
        // Regular response (either no tools or post-tool execution)
        const answer = (_d = message_content.content) !== null && _d !== void 0 ? _d : 'Sorry, I could not generate a response.';
        if (isEmulator) {
            console.log('📤 MCP Chat LLM Response:', JSON.stringify({
                provider: actualLlmProvider,
                model: actualLlmModel,
                status: llmResponse.status,
                hasToolCalls: !!((_e = message_content.tool_calls) === null || _e === void 0 ? void 0 : _e.length),
                answerLength: answer.length,
                isFollowUp: !!toolResults
            }, null, 2));
        }
        return { answer };
    }
    catch (error) {
        console.error('Error in mcpChat:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to process MCP chat request');
    }
});
exports.visionChat = functions
    .runWith({ timeoutSeconds: function_constants_1.FUNCTION_CONSTANTS.TIMEOUTS.VISION_CHAT, memory: function_constants_1.FUNCTION_CONSTANTS.MEMORY.SMALL })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }
    const { message, imageData, visionProvider, visionModel } = data;
    // Use provided models from UI - these should always be provided by the frontend
    // Fallback to config defaults only if UI doesn't provide them
    const defaults = models_config_1.modelsConfigService.getDefaultSelection('vision');
    const actualVisionProvider = visionProvider || ((_a = defaults === null || defaults === void 0 ? void 0 : defaults.vision) === null || _a === void 0 ? void 0 : _a.provider) || function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.LLM_PROVIDER;
    const actualVisionModel = visionModel || ((_b = defaults === null || defaults === void 0 ? void 0 : defaults.vision) === null || _b === void 0 ? void 0 : _b.model) || function_constants_1.FUNCTION_CONSTANTS.DEFAULTS.VISION_MODEL;
    console.log('Vision chat request:', { actualVisionProvider, actualVisionModel });
    if (!message || !imageData) {
        throw new functions.https.HttpsError('invalid-argument', 'message and imageData required');
    }
    try {
        // Get Vision API key
        const visionApiKeyEnvVar = models_config_1.modelsConfigService.getApiKeyEnvVar(actualVisionProvider);
        const visionKey = process.env[visionApiKeyEnvVar];
        if (!visionKey) {
            console.error(`${visionApiKeyEnvVar} not found`);
            throw new functions.https.HttpsError('internal', `${visionApiKeyEnvVar} not configured`);
        }
        const visionApiUrl = models_config_1.modelsConfigService.getProviderApiUrl(actualVisionProvider, 'VISION');
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
            temperature: function_constants_1.FUNCTION_CONSTANTS.LLM_CONFIG.VISION_TEMPERATURE,
            max_tokens: function_constants_1.FUNCTION_CONSTANTS.LLM_CONFIG.VISION_MAX_TOKENS
        };
        const visionHeaders = models_config_1.modelsConfigService.getProviderHeaders(actualVisionProvider, visionKey, 'vision');
        if (isEmulator) {
            console.log('🔍 Vision Chat Request:', JSON.stringify({
                provider: actualVisionProvider,
                model: actualVisionModel,
                url: visionApiUrl,
                method: 'POST',
                headers: Object.assign({}, models_config_1.modelsConfigService.getProviderHeaders(actualVisionProvider, `${visionKey.substring(0, 10)}...`, 'vision')),
                body: Object.assign(Object.assign({}, visionRequestBody), { messages: [{
                            role: 'user',
                            content: [
                                { type: 'text', text: `${message.substring(0, 100)}...` },
                                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,[IMAGE_DATA]' } }
                            ]
                        }] })
            }, null, 2));
        }
        const visionResponse = await (0, node_fetch_1.default)(visionApiUrl, {
            method: 'POST',
            headers: visionHeaders,
            body: JSON.stringify(visionRequestBody)
        });
        if (!visionResponse.ok) {
            const errorText = await visionResponse.text();
            console.error('Vision API error:', visionResponse.status, errorText);
            throw new functions.https.HttpsError('internal', 'Failed to analyze image');
        }
        const visionJson = await visionResponse.json();
        const answer = (_f = (_e = (_d = (_c = visionJson.choices) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.message) === null || _e === void 0 ? void 0 : _e.content) !== null && _f !== void 0 ? _f : 'Sorry, I could not analyze the image.';
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
                    choicesCount: ((_g = visionJson.choices) === null || _g === void 0 ? void 0 : _g.length) || 0
                }
            }, null, 2));
        }
        console.log(`Successfully generated vision response`);
        return { answer };
    }
    catch (error) {
        console.error('Error in visionChat:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to process vision request');
    }
});
exports.deleteDocument = functions
    .runWith({ timeoutSeconds: function_constants_1.FUNCTION_CONSTANTS.TIMEOUTS.DELETE_DOCUMENT, memory: function_constants_1.FUNCTION_CONSTANTS.MEMORY.SMALL })
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
        if ((docData === null || docData === void 0 ? void 0 : docData.uid) !== uid) {
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
            }
            catch (storageError) {
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
                const updatedDocs = (sessionData.associatedDocuments || []).filter((id) => id !== docId);
                return sessionDoc.ref.update({ associatedDocuments: updatedDocs });
            });
            await Promise.all(sessionUpdates);
        }
        // 5) Delete the document record
        await docRef.delete();
        console.log(`Document ${docId} completely deleted`);
        return { success: true };
    }
    catch (error) {
        console.error('Error in deleteDocument:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to delete document');
    }
});
exports.deleteSession = functions
    .runWith({ timeoutSeconds: function_constants_1.FUNCTION_CONSTANTS.TIMEOUTS.DELETE_SESSION, memory: function_constants_1.FUNCTION_CONSTANTS.MEMORY.SMALL })
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
        if ((sessionData === null || sessionData === void 0 ? void 0 : sessionData.uid) !== uid) {
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
                if ((docData === null || docData === void 0 ? void 0 : docData.uid) !== uid) {
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
                    }
                    catch (storageError) {
                        console.warn('Failed to delete storage file:', storageError);
                    }
                }
                // Delete document record
                await docRef.delete();
                console.log(`Document ${docId} deleted`);
            }
            catch (docError) {
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
    }
    catch (error) {
        console.error('Error in deleteSession:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to delete session');
    }
});
// MCP Weather Server (SSE-based for web clients)
exports.mcpWeatherServer = functions
    .runWith({ timeoutSeconds: function_constants_1.FUNCTION_CONSTANTS.TIMEOUTS.MCP_WEATHER_SERVER, memory: function_constants_1.FUNCTION_CONSTANTS.MEMORY.SMALL })
    .https.onRequest(async (req, res) => {
    var _a, _b;
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
                id: ((_a = req.body) === null || _a === void 0 ? void 0 : _a.id) || 1,
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
                id: ((_b = req.body) === null || _b === void 0 ? void 0 : _b.id) || 1,
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
                        },
                        {
                            name: 'get_forecast',
                            description: 'Get 7-day weather forecast for a city',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    city: {
                                        type: 'string',
                                        description: 'The city to get forecast for'
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
                const city = (toolArgs === null || toolArgs === void 0 ? void 0 : toolArgs.city) || '';
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
                }
                catch (error) {
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
            if (name === 'get_forecast') {
                const city = (toolArgs === null || toolArgs === void 0 ? void 0 : toolArgs.city) || '';
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
                    // Get forecast data
                    const forecast = await getForecastData(coordinates.lat, coordinates.lon);
                    const callResponse = {
                        jsonrpc: '2.0',
                        id: id || 1,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: `7-day forecast for ${coordinates.name}:\n\n${forecast}`
                                }
                            ]
                        }
                    };
                    res.json(callResponse);
                    return;
                }
                catch (error) {
                    console.error('Error getting forecast:', error);
                    const errorResponse = {
                        jsonrpc: '2.0',
                        id: id || 1,
                        error: {
                            code: -32603,
                            message: 'Failed to get forecast data'
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
            }, function_constants_1.FUNCTION_CONSTANTS.SSE.HEARTBEAT_INTERVAL);
            // Clean up on client disconnect
            req.on('close', () => {
                clearInterval(heartbeat);
                console.log('MCP SSE client disconnected');
            });
            // Clean up on response finish
            res.on('finish', () => {
                clearInterval(heartbeat);
            });
            // Clean up on response error
            res.on('error', () => {
                clearInterval(heartbeat);
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
    }
    catch (error) {
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
//# sourceMappingURL=index.js.map