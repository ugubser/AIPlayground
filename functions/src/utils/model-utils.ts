// Model utility functions for backend
import modelsConfig from '../models.config.json';

export interface ModelUrls {
  [provider: string]: {
    [modelType: string]: string;
  };
}

export interface ApiKeyMapping {
  [provider: string]: string;
}

// Dynamic API URLs loaded from config
function loadApiUrls(): ModelUrls {
  const urls: ModelUrls = {};
  const config = modelsConfig as any;
  
  if (config.providers) {
    for (const [provider, providerConfig] of Object.entries(config.providers)) {
      const providerData = providerConfig as any;
      if (providerData.apiUrls) {
        urls[provider] = providerData.apiUrls;
      }
    }
  }
  
  return urls;
}

export const API_URLS: ModelUrls = loadApiUrls();

// Dynamic API key mappings loaded from config
function loadApiKeyMappings(): ApiKeyMapping {
  const mappings: ApiKeyMapping = {};
  const config = modelsConfig as any;
  
  if (config.providers) {
    for (const [provider, providerConfig] of Object.entries(config.providers)) {
      const providerData = providerConfig as any;
      if (providerData.apiKeyEnvVar) {
        mappings[provider] = providerData.apiKeyEnvVar;
      }
    }
  }
  
  return mappings;
}

export const API_KEY_ENV_VARS: ApiKeyMapping = loadApiKeyMappings();

// Dynamic embedding providers loaded from config
function loadEmbeddingProviders(): string[] {
  const providers: string[] = [];
  const config = modelsConfig as any;
  
  if (config.providers) {
    for (const [provider, providerConfig] of Object.entries(config.providers)) {
      const providerData = providerConfig as any;
      if (providerData.capabilities && providerData.capabilities.includes('EMBED')) {
        providers.push(provider);
      }
    }
  }
  
  return providers;
}

export const EMBEDDING_PROVIDERS = loadEmbeddingProviders();

// App info for headers
export const APP_INFO = {
  referer: 'https://aiplayground-6e5be.web.app',
  title: {
    default: 'Firebase RAG Chatbot',
    chat: 'Vanguard Signals AI Playground'
  }
};

/**
 * Gets API URL for a provider and model type
 */
export function getProviderApiUrl(provider: string, modelType: string): string {
  return API_URLS[provider]?.[modelType] || '';
}

/**
 * Gets environment variable name for API key
 */
export function getApiKeyEnvVar(provider: string): string {
  return API_KEY_ENV_VARS[provider] || 'UNKNOWN_API_KEY';
}

/**
 * Checks if provider supports embeddings
 */
export function supportsEmbeddings(provider: string): boolean {
  return EMBEDDING_PROVIDERS.includes(provider);
}

/**
 * Gets headers for API requests
 */
export function getProviderHeaders(provider: string, apiKey: string, appName?: string): { [key: string]: string } {
  const headers: { [key: string]: string } = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  if (provider === 'openrouter.ai') {
    headers['HTTP-Referer'] = APP_INFO.referer;
    headers['X-Title'] = appName === 'chat' ? APP_INFO.title.chat : APP_INFO.title.default;
  }

  return headers;
}