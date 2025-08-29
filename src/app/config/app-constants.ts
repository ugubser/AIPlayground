export const APP_CONSTANTS = {
  // File upload limits
  FILE_SIZE: {
    PDF_MAX_SIZE: 50 * 1024 * 1024, // 50MB
    IMAGE_MAX_SIZE: 10 * 1024 * 1024, // 10MB
  },

  // UI delays and timeouts
  TIMEOUTS: {
    UPLOAD_COMPLETE_DISPLAY: 2000, // 2 seconds
    SCROLL_DELAY: 100, // 100ms for smooth scrolling
    SCROLL_DELAY_EXTENDED: 200, // 200ms for delayed scrolling
  },

  // PDF processing
  PDF_PROCESSING: {
    CHUNK_SIZE: 400,
    CHUNK_OVERLAP: 50,
  },

  // File format constants
  FILE_TYPES: {
    PDF: 'application/pdf',
    IMAGE_PREFIX: 'image/',
  },

  // UI limits
  UI: {
    MAX_TITLE_LENGTH: 40,
  },
} as const;