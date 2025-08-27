# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Firebase RAG (Retrieval-Augmented Generation) chatbot application built with Angular 17 and Firebase. Users can upload PDF documents and ask questions about their content using AI-powered question answering.

## Key Architecture

### Frontend Structure
- **Angular 17** with standalone components (no NgModules)
- **Main app**: `src/app/` with components in `src/app/components/`
- **Services**: Authentication, chat, document processing, model selection
- **Firebase integration**: Auth, Firestore, Storage, Functions via AngularFire

### Backend Structure
- **Firebase Functions**: `functions/` directory with TypeScript source in `functions/src/`
- **RAG Implementation**: Document chunking, embeddings (Together.ai), and chat completions (OpenRouter)
- **Data Storage**: PDFs in Firebase Storage, text chunks and embeddings in Firestore

### Environment Configuration
- **Development**: Uses Firebase emulators (Auth:9099, Firestore:8080, Storage:9199, Functions:5001)
- **Build process**: `scripts/build-env.js` generates environment files from templates
- **API Keys**: Together.ai and OpenRouter APIs for embeddings and chat completions

## Development Commands

### Main Development Workflow
```bash
# Start Firebase emulators (required for development)
npm run emulators

# Start Angular dev server (in separate terminal)
npm start
```

### Build Commands
```bash
# Development build
npm run build

# Production build  
npm run build:prod

# Watch mode
npm run watch

# Build functions only
npm run build:functions
```

### Testing
```bash
# Run Angular tests
npm test
```

### Firebase Operations
```bash
# Start emulators with hosting
npm run emulators:hosting

# Deploy everything (build + functions + deploy)
npm run deploy
```

## Code Patterns

### Service Architecture
- **Global model selection**: `GlobalModelSelectionService` manages AI model configuration
- **Models config**: Dynamic model loading from `models.config.json`
- **Firebase services**: Separate services for auth, chat, document processing

### Component Structure
- **Standalone components**: All components use standalone architecture
- **Dynamic model selector**: `DynamicModelSelectorComponent` for AI model switching
- **Dashboard**: Main interface in `DashboardComponent`

### Firebase Integration
- **Emulator configuration**: Conditional connection to emulators in `app.config.ts`
- **Collection structure**: `/documents/{docId}/chunks/{chunkId}` and `/sessions/{sessionId}/messages/{messageId}`
- **File upload**: PDFs stored as `/documents/{userId}/{timestamp}_{filename}.pdf`

## Dependencies and APIs

### External Services
- **Together.ai**: Used for text embeddings (`BAAI/bge-base-en-v1.5-vllm`)
- **OpenRouter**: Used for chat completions (`meta-llama/llama-3.1-70b-instruct`)
- **PDF.js**: Client-side PDF text extraction
- **LangChain**: Text chunking and processing

### Environment Setup
- Copy `.env.template` to `.env` and configure API keys
- Copy `functions/.env.template` to `functions/.env` for emulator development
- Set Firebase Functions secrets for production deployment

## Testing and Quality

When making changes, always run the test suite with `npm test` to ensure Angular components and services work correctly. The project uses Jasmine and Karma for testing.