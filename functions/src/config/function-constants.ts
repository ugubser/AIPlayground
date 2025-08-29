export const FUNCTION_CONSTANTS = {
  // Function configuration
  TIMEOUTS: {
    EMBED_CHUNKS: 540, // 9 minutes
    CHAT_RAG: 60, // 1 minute
    GENERAL_CHAT: 60, // 1 minute
    MCP_CHAT: 60, // 1 minute
    VISION_CHAT: 60, // 1 minute
    DELETE_DOCUMENT: 60, // 1 minute
    DELETE_SESSION: 300, // 5 minutes
    MCP_WEATHER_SERVER: 540, // 9 minutes
  },

  // Memory allocation
  MEMORY: {
    SMALL: '1GB',
    LARGE: '2GB',
  },

  // Batch limits
  BATCH_LIMITS: {
    MAX_TEXTS_PER_BATCH: 256,
    MAX_CHUNKS_QUERY: 5000,
    MAX_SESSION_DOCS_QUERY: 1000,
    DEFAULT_TOP_K: 8,
  },

  // LLM parameters
  LLM_CONFIG: {
    RAG_TEMPERATURE: 0.2,
    RAG_MAX_TOKENS: 1000,
    CHAT_TEMPERATURE: 0.7,
    CHAT_MAX_TOKENS: 2000,
    VISION_TEMPERATURE: 0.7,
    VISION_MAX_TOKENS: 2000,
  },

  // SSE configuration
  SSE: {
    HEARTBEAT_INTERVAL: 30000, // 30 seconds
  },

  // Default providers and models
  DEFAULTS: {
    EMBED_PROVIDER: 'together.ai',
    EMBED_MODEL: 'BAAI/bge-base-en-v1.5',
    LLM_PROVIDER: 'openrouter.ai',
    LLM_MODEL: 'openai/gpt-oss-20b:free',
    VISION_MODEL: 'openai/gpt-4o',
    MCP_MODEL: 'meta-llama/llama-4-maverick:free',
  },
} as const;