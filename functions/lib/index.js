"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatRag = exports.embedChunks = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const node_fetch_1 = require("node-fetch");
admin.initializeApp();
const db = admin.firestore();
const TOGETHER_URL = 'https://api.together.xyz/v1/embeddings';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
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
    .runWith({ timeoutSeconds: 540, memory: '2GB' })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }
    const { texts } = data;
    if (!Array.isArray(texts) || texts.length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'texts array required');
    }
    if (texts.length > 256) {
        throw new functions.https.HttpsError('invalid-argument', 'Maximum 256 texts per batch');
    }
    const key = process.env.TOGETHER_API_KEY;
    if (!key) {
        console.error('TOGETHER_API_KEY not found in environment');
        throw new functions.https.HttpsError('internal', 'TOGETHER_API_KEY not configured');
    }
    console.log('TOGETHER_API_KEY found:', !!key);
    try {
        console.log(`Processing ${texts.length} texts for embeddings`);
        const response = await (0, node_fetch_1.default)(TOGETHER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'BAAI/bge-base-en-v1.5-vllm',
                input: texts
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Together API error:', {
                status: response.status,
                statusText: response.statusText,
                url: TOGETHER_URL,
                error: errorText,
                hasApiKey: !!key
            });
            throw new functions.https.HttpsError('internal', `Together API error: ${response.statusText} - ${errorText}`);
        }
        const json = await response.json();
        const vectors = (json.data || []).map((d) => d.embedding);
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
    .runWith({ timeoutSeconds: 60, memory: '1GB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }
    const { sessionId, message, k = 8, restrictDocId } = data;
    if (!sessionId || !message) {
        throw new functions.https.HttpsError('invalid-argument', 'sessionId and message required');
    }
    const uid = context.auth.uid;
    try {
        console.log(`Processing RAG query for user ${uid}: "${message.substring(0, 100)}..."`);
        // 1) Embed the query
        const togetherKey = process.env.TOGETHER_API_KEY;
        if (!togetherKey) {
            console.error('TOGETHER_API_KEY not found for chat');
            throw new functions.https.HttpsError('internal', 'TOGETHER_API_KEY not configured');
        }
        const embResponse = await (0, node_fetch_1.default)(TOGETHER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${togetherKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'BAAI/bge-base-en-v1.5-vllm',
                input: [message]
            })
        });
        if (!embResponse.ok) {
            throw new functions.https.HttpsError('internal', 'Failed to embed query');
        }
        const embJson = await embResponse.json();
        const queryVector = (_c = (_b = (_a = embJson.data) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.embedding) !== null && _c !== void 0 ? _c : [];
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
            }
            else {
                console.log(`Trying simple query: uid=${uid}`);
                let chunksQuery = db.collectionGroup('chunks')
                    .where('uid', '==', uid)
                    .limit(5000);
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
        console.log(`Found ${allChunks.length} chunks to search through`);
        // Calculate similarity scores and get top-K
        const scoredChunks = allChunks
            .map((chunk) => ({
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
        // 4) Generate response with OpenRouter
        const openrouterKey = process.env.OPENROUTER_API_KEY;
        if (!openrouterKey) {
            console.error('OPENROUTER_API_KEY not found');
            throw new functions.https.HttpsError('internal', 'OPENROUTER_API_KEY not configured');
        }
        const llmResponse = await (0, node_fetch_1.default)(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openrouterKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://aiplayground-6e5be.web.app',
                'X-Title': 'Firebase RAG Chatbot'
            },
            body: JSON.stringify({
                model: 'meta-llama/llama-3.1-70b-instruct',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.2,
                max_tokens: 1000
            })
        });
        if (!llmResponse.ok) {
            const errorText = await llmResponse.text();
            console.error('OpenRouter API error:', llmResponse.status, errorText);
            throw new functions.https.HttpsError('internal', 'Failed to generate response');
        }
        const llmJson = await llmResponse.json();
        const answer = (_g = (_f = (_e = (_d = llmJson.choices) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.message) === null || _f === void 0 ? void 0 : _f.content) !== null && _g !== void 0 ? _g : 'Sorry, I could not generate a response.';
        // 5) Prepare sources for frontend
        const sources = scoredChunks.map((item, index) => ({
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
//# sourceMappingURL=index.js.map