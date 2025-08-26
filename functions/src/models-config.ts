import modelsConfig from './models.config.json';

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

  getDefaultSelection(appName: string): RAGModelSelection | null {
    if (appName !== 'rag') return null;

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

  validateSelection(appName: string, modelType: string, provider: string, model: string): boolean {
    const models = this.getModels(appName, modelType, provider);
    return models.includes(model);
  }

  getProviderApiUrl(provider: string, modelType: string): string {
    const urls: { [key: string]: { [key: string]: string } } = {
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

    return urls[provider]?.[modelType] || '';
  }

  getProviderHeaders(provider: string, apiKey: string, appName?: string): { [key: string]: string } {
    const headers: { [key: string]: string } = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    if (provider === 'openrouter.ai') {
      headers['HTTP-Referer'] = 'https://aiplayground-6e5be.web.app';
      headers['X-Title'] = appName === 'chat' ? 'Vanguard Signals AI Playground' : 'Firebase RAG Chatbot';
    }

    return headers;
  }

  getApiKeyEnvVar(provider: string): string {
    const envVars: { [key: string]: string } = {
      'together.ai': 'TOGETHER_API_KEY',
      'openrouter.ai': 'OPENROUTER_API_KEY',
      'ollama': 'OLLAMA_API_KEY'
    };

    return envVars[provider] || 'UNKNOWN_API_KEY';
  }

  supportsEmbeddings(provider: string): boolean {
    return ['together.ai', 'ollama'].includes(provider);
  }
}

export const modelsConfigService = new ModelsConfigService();