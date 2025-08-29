"use strict";
// Shared model utility functions for both frontend and backend
Object.defineProperty(exports, "__esModule", { value: true });
exports.APP_INFO = exports.EMBEDDING_PROVIDERS = exports.API_KEY_ENV_VARS = exports.API_URLS = void 0;
exports.getProviderApiUrl = getProviderApiUrl;
exports.getApiKeyEnvVar = getApiKeyEnvVar;
exports.supportsEmbeddings = supportsEmbeddings;
exports.getProviderHeaders = getProviderHeaders;
// Centralized API URLs configuration
exports.API_URLS = {
    'openrouter.ai': {
        'LLM': 'https://openrouter.ai/api/v1/chat/completions',
        'VISION': 'https://openrouter.ai/api/v1/chat/completions'
    },
    'together.ai': {
        'LLM': 'https://api.together.xyz/v1/chat/completions',
        'EMBED': 'https://api.together.xyz/v1/embeddings',
        'VISION': 'https://api.together.xyz/v1/chat/completions'
    },
    'ollama': {
        'LLM': 'http://localhost:11434/api/v1/chat/completions',
        'EMBED': 'http://localhost:11434/api/embed'
    }
};
// Centralized API key environment variable mapping
exports.API_KEY_ENV_VARS = {
    'together.ai': 'TOGETHER_API_KEY',
    'openrouter.ai': 'OPENROUTER_API_KEY',
    'ollama': 'OLLAMA_API_KEY'
};
// Providers that support embeddings
exports.EMBEDDING_PROVIDERS = ['together.ai', 'ollama'];
// App info for headers
exports.APP_INFO = {
    referer: 'https://aiplayground-6e5be.web.app',
    title: {
        default: 'Firebase RAG Chatbot',
        chat: 'Vanguard Signals AI Playground'
    }
};
/**
 * Gets API URL for a provider and model type
 */
function getProviderApiUrl(provider, modelType) {
    var _a;
    return ((_a = exports.API_URLS[provider]) === null || _a === void 0 ? void 0 : _a[modelType]) || '';
}
/**
 * Gets environment variable name for API key
 */
function getApiKeyEnvVar(provider) {
    return exports.API_KEY_ENV_VARS[provider] || 'UNKNOWN_API_KEY';
}
/**
 * Checks if provider supports embeddings
 */
function supportsEmbeddings(provider) {
    return exports.EMBEDDING_PROVIDERS.includes(provider);
}
/**
 * Gets headers for API requests
 */
function getProviderHeaders(provider, apiKey, appName) {
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
    if (provider === 'openrouter.ai') {
        headers['HTTP-Referer'] = exports.APP_INFO.referer;
        headers['X-Title'] = appName === 'chat' ? exports.APP_INFO.title.chat : exports.APP_INFO.title.default;
    }
    return headers;
}
//# sourceMappingURL=model-utils.js.map