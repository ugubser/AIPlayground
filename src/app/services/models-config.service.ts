import { Injectable } from '@angular/core';
import modelsConfig from '../../../shared/config/models.config.json';
import { getProviderApiUrl, getApiKeyEnvVar, supportsEmbeddings, getProviderHeaders } from '../utils/model-utils';

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

export interface DynamicModelSelection {
  [modelType: string]: ModelSelection;
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

  getDefaultSelection(appName: string): DynamicModelSelection | null {
    const modelTypes = this.getModelTypes(appName);
    if (modelTypes.length === 0) return null;

    const selection: DynamicModelSelection = {};
    
    for (const modelType of modelTypes) {
      const providers = this.getProviders(appName, modelType);
      if (providers.length > 0) {
        const firstProvider = providers[0];
        const models = this.getModels(appName, modelType, firstProvider);
        if (models.length > 0) {
          selection[modelType.toLowerCase()] = {
            provider: firstProvider,
            model: models[0]
          };
        }
      }
    }
    
    return Object.keys(selection).length > 0 ? selection : null;
  }

  validateSelection(appName: string, modelType: string, provider: string, model: string): boolean {
    const models = this.getModels(appName, modelType, provider);
    return models.includes(model);
  }

  // Backwards compatibility method for RAG
  getDefaultRAGSelection(): RAGModelSelection | null {
    const dynamicSelection = this.getDefaultSelection('rag');
    if (!dynamicSelection || !dynamicSelection['llm'] || !dynamicSelection['embed']) {
      return null;
    }
    
    return {
      llm: dynamicSelection['llm'],
      embed: dynamicSelection['embed']
    };
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