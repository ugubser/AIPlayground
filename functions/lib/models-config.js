"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelsConfigService = exports.ModelsConfigService = void 0;
const models_config_json_1 = __importDefault(require("./models.config.json"));
class ModelsConfigService {
    constructor() {
        this.config = models_config_json_1.default;
    }
    getApps() {
        return Object.keys(this.config);
    }
    getModelTypes(appName) {
        return this.config[appName] ? Object.keys(this.config[appName]) : [];
    }
    getProviders(appName, modelType) {
        const app = this.config[appName];
        if (!app || !app[modelType])
            return [];
        return Object.keys(app[modelType]);
    }
    getModels(appName, modelType, provider) {
        const app = this.config[appName];
        if (!app || !app[modelType] || !app[modelType][provider])
            return [];
        return app[modelType][provider];
    }
    getDefaultSelection(appName) {
        if (appName === 'rag') {
            // These should only be used as absolute fallbacks when UI doesn't provide models
            return {
                llm: {
                    provider: 'openrouter.ai',
                    model: 'openai/gpt-oss-20b:free'
                },
                embed: {
                    provider: 'together.ai',
                    model: 'BAAI/bge-base-en-v1.5'
                }
            };
        }
        else if (appName === 'vision') {
            return {
                vision: {
                    provider: 'openrouter.ai',
                    model: 'openai/gpt-4o'
                }
            };
        }
        else if (appName === 'chat') {
            return {
                llm: {
                    provider: 'openrouter.ai',
                    model: 'openai/gpt-oss-20b:free'
                },
                embed: {
                    provider: 'together.ai',
                    model: 'BAAI/bge-base-en-v1.5'
                }
            };
        }
        return null;
    }
    validateSelection(appName, modelType, provider, model) {
        const models = this.getModels(appName, modelType, provider);
        return models.includes(model);
    }
    getProviderApiUrl(provider, modelType) {
        var _a;
        const urls = {
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
        return ((_a = urls[provider]) === null || _a === void 0 ? void 0 : _a[modelType]) || '';
    }
    getProviderHeaders(provider, apiKey, appName) {
        const headers = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        };
        if (provider === 'openrouter.ai') {
            headers['HTTP-Referer'] = 'https://aiplayground-6e5be.web.app';
            headers['X-Title'] = appName === 'chat' ? 'Vanguard Signals AI Playground' : 'Firebase RAG Chatbot';
        }
        return headers;
    }
    getApiKeyEnvVar(provider) {
        const envVars = {
            'together.ai': 'TOGETHER_API_KEY',
            'openrouter.ai': 'OPENROUTER_API_KEY',
            'ollama': 'OLLAMA_API_KEY'
        };
        return envVars[provider] || 'UNKNOWN_API_KEY';
    }
    supportsEmbeddings(provider) {
        return ['together.ai', 'ollama'].includes(provider);
    }
}
exports.ModelsConfigService = ModelsConfigService;
exports.modelsConfigService = new ModelsConfigService();
//# sourceMappingURL=models-config.js.map