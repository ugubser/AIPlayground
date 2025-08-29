"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelsConfigService = exports.ModelsConfigService = void 0;
const models_config_json_1 = __importDefault(require("./models.config.json"));
const model_utils_1 = require("./utils/model-utils");
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
        return (0, model_utils_1.getProviderApiUrl)(provider, modelType);
    }
    getProviderHeaders(provider, apiKey, appName) {
        return (0, model_utils_1.getProviderHeaders)(provider, apiKey, appName);
    }
    getApiKeyEnvVar(provider) {
        return (0, model_utils_1.getApiKeyEnvVar)(provider);
    }
    supportsEmbeddings(provider) {
        return (0, model_utils_1.supportsEmbeddings)(provider);
    }
}
exports.ModelsConfigService = ModelsConfigService;
exports.modelsConfigService = new ModelsConfigService();
//# sourceMappingURL=models-config.js.map