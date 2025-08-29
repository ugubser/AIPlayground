// Model utility functions

export interface ModelUrls {
  [provider: string]: {
    [modelType: string]: string;
  };
}

export interface ApiKeyMapping {
  [provider: string]: string;
}

// Centralized API URLs configuration
export const API_URLS: ModelUrls = {
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
export const API_KEY_ENV_VARS: ApiKeyMapping = {
  'together.ai': 'TOGETHER_API_KEY',
  'openrouter.ai': 'OPENROUTER_API_KEY',
  'ollama': 'OLLAMA_API_KEY'
};

// Providers that support embeddings
export const EMBEDDING_PROVIDERS = ['together.ai', 'ollama'];

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