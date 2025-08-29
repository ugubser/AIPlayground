import modelsConfig from './models.config.json';
import { getProviderApiUrl, getApiKeyEnvVar, supportsEmbeddings, getProviderHeaders } from './utils/model-utils';

export interface ModelConfig {
  [appName: string]: {
    [modelType: string]: {
      [provider: string]: string[];
    };
  };
}

export interface ModelSelection {
  provider: string;
  model: string;
}

export interface RAGModelSelection {
  llm: ModelSelection;
  embed: ModelSelection;
}

export interface VisionModelSelection {
  vision: ModelSelection;
}

export type AppModelSelection = RAGModelSelection | VisionModelSelection;

export class ModelsConfigService {
  private config: ModelConfig = modelsConfig;

  getApps(): string[] {
    return Object.keys(this.config);
  }

  getModelTypes(appName: string): string[] {
    return this.config[appName] ? Object.keys(this.config[appName]) : [];
  }

  getProviders(appName: string, modelType: string): string[] {
    const app = this.config[appName];
    if (!app || !app[modelType]) return [];
    return Object.keys(app[modelType]);
  }

  getModels(appName: string, modelType: string, provider: string): string[] {
    const app = this.config[appName];
    if (!app || !app[modelType] || !app[modelType][provider]) return [];
    return app[modelType][provider];
  }

  getDefaultSelection(appName: string): AppModelSelection | null {
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
      } as RAGModelSelection;
    } else if (appName === 'vision') {
      return {
        vision: {
          provider: 'openrouter.ai',
          model: 'openai/gpt-4o'
        }
      } as VisionModelSelection;
    } else if (appName === 'chat') {
      return {
        llm: {
          provider: 'openrouter.ai',
          model: 'openai/gpt-oss-20b:free'
        },
        embed: {
          provider: 'together.ai',
          model: 'BAAI/bge-base-en-v1.5'
        }
      } as RAGModelSelection;
    }

    return null;
  }

  validateSelection(appName: string, modelType: string, provider: string, model: string): boolean {
    const models = this.getModels(appName, modelType, provider);
    return models.includes(model);
  }

  getProviderApiUrl(provider: string, modelType: string): string {
    return getProviderApiUrl(provider, modelType);
  }

  getProviderHeaders(provider: string, apiKey: string, appName?: string): { [key: string]: string } {
    return getProviderHeaders(provider, apiKey, appName);
  }

  getApiKeyEnvVar(provider: string): string {
    return getApiKeyEnvVar(provider);
  }

  supportsEmbeddings(provider: string): boolean {
    return supportsEmbeddings(provider);
  }
}

export const modelsConfigService = new ModelsConfigService();