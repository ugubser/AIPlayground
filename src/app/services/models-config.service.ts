import { Injectable } from '@angular/core';
import modelsConfig from '../config/models.config.json';

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

@Injectable({
  providedIn: 'root'
})
export class ModelsConfigService {
  private config: ModelConfig = modelsConfig;

  constructor() { }

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

    // Default to current working configuration
    return {
      llm: {
        provider: 'openrouter.ai',
        model: 'meta-llama/llama-3.3-70b-instruct'
      },
      embed: {
        provider: 'together.ai',
        model: 'BAAI/bge-base-en-v1.5-vllm'
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
      }
    };

    return urls[provider]?.[modelType] || '';
  }

  getProviderHeaders(provider: string, apiKey: string): { [key: string]: string } {
    const headers: { [key: string]: string } = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    if (provider === 'openrouter.ai') {
      headers['HTTP-Referer'] = 'https://aiplayground-6e5be.web.app';
      headers['X-Title'] = 'Firebase RAG Chatbot';
    }

    return headers;
  }
}