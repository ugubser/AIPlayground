# AI Playground - Multi-Modal Chat Application

A comprehensive AI-powered application built with Angular and Firebase, featuring Retrieval-Augmented Generation (RAG), Vision capabilities, and extensible Model Context Protocol (MCP) integrations. Upload documents, analyze images, and interact with various utility services through natural language.

## Features

### Core AI Capabilities
- 🤖 **Multi-modal chat interface** with support for text, images, and documents
- 📄 **RAG-powered document Q&A** - Upload PDFs and ask questions about their content
- 🖼️ **Vision analysis** - Upload images for AI-powered analysis and description
- 🔧 **MCP integrations** - Extensible tool ecosystem for various utilities

### Document & Data Management
- 📚 **Document upload and processing** with chunking and embeddings
- 💬 **Multi-session chat interface** with conversation history
- 🗄️ **Persistent storage** for documents, chats, and user data
- 🔒 **Secure authentication** (anonymous and user accounts)

### MCP Tool Ecosystem
- 🌤️ **Weather data** - Current weather and forecasts via OpenMeteo
- 💰 **Financial data** - Stock prices and metrics via Yahoo Finance
- 🕒 **Time utilities** - Timezone conversion and current time lookup
- 🔄 **Unit conversion** - Convert between various units (temperature, length, mass, volume, data)
- 🧮 **Mathematical calculations** - Expression evaluation, statistics, matrix operations
- 💱 **Currency conversion** - Real-time exchange rates and historical data

### Development & Deployment
- 🚀 **Firebase emulator support** for local development
- 🏗️ **Production deployment** to Firebase hosting and functions

## Tech Stack

### Frontend
- **Angular 17** with standalone components
- **Multi-modal interface** supporting text, images, and documents
- **Real-time updates** with Firebase integration
- **Dynamic AI model selection** with configurable providers

### Backend
- **Firebase** (Auth, Firestore, Storage, Functions, Hosting)
- **Model Context Protocol (MCP)** servers for extensible tool integrations
- **RESTful APIs** for AI service integrations

### AI & Processing
- **Document Processing**: PDF.js + LangChain.js text splitters
- **Embeddings**: Together.ai (BAAI/bge-m3 model) for RAG
- **LLM**: OpenRouter (Llama 3.1 70B Instruct) for chat and vision
- **Vision**: Multi-modal LLMs for image analysis

### MCP Services
- **Weather**: OpenMeteo APIs
- **Finance**: Yahoo Finance APIs  
- **Time**: Built-in timezone handling
- **Unit Conversion**: Mathematical conversion utilities
- **Calculator**: mathjs for mathematical computations
- **Currency**: Frankfurter API for exchange rates

### Development
- **Firebase emulators** for local development
- **TypeScript** throughout the stack
- **Environment-based configuration** for different deployment targets

## Prerequisites

- Node.js 18+ 
- Firebase CLI
- Together.ai API key
- OpenRouter API key

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   cd functions && npm install && cd ..
   ```

2. **Configure environment variables:**
   - Copy `.env.template` to `.env` and fill in your values:
     - Firebase configuration (already provided)
     - `TOGETHER_API_KEY` - your Together.ai API key
     - `OPENROUTER_API_KEY` - your OpenRouter API key
   - Copy `functions/.env.template` to `functions/.env` and add the same API keys for local emulator development

3. **Set up Firebase Functions secrets (for deployment):**
   ```bash
   firebase functions:secrets:set TOGETHER_API_KEY
   firebase functions:secrets:set OPENROUTER_API_KEY
   ```

## Development

1. **Start Firebase emulators:**
   ```bash
   npm run emulators
   ```
   This will:
   - Generate environment files from templates using your `.env` values
   - Start all Firebase emulators:
     - Auth emulator on port 9099
     - Firestore emulator on port 8080  
     - Storage emulator on port 9199
     - Functions emulator on port 5001
     - Hosting emulator on port 5050
     - Emulator UI on port 4000

2. **In another terminal, start Angular dev server:**
   ```bash
   npm start
   ```
   Access the app at http://localhost:4200

3. **Monitor emulators:**
   - Emulator UI: http://localhost:4000
   - Firestore: http://localhost:4000/firestore
   - Auth: http://localhost:4000/auth
   - Storage: http://localhost:4000/storage

## Usage

### Getting Started
1. **Sign in** (anonymous authentication or create account)
2. **Choose your interaction mode**:
   - **Chat Tab**: General conversation with AI models
   - **Documents Tab**: Upload PDFs for document-based Q&A
   - **Vision Tab**: Upload images for AI analysis

### Document-Based Q&A (RAG)
1. **Upload PDFs** on the Documents tab
2. **Start chatting** - create a new chat session
3. **Filter by document** to ask questions about specific files
4. **View sources** - see which document chunks were used to answer questions

### Vision Analysis
1. **Upload images** in the Vision tab
2. **Ask questions** about image content, request analysis, or get descriptions
3. **Multi-modal conversations** combining text and visual understanding

### MCP Tools Integration
1. **Enable MCP servers** in chat settings (Weather, Finance, Time, etc.)
2. **Natural language requests** - Ask about weather, stock prices, unit conversions
3. **Automatic tool selection** - AI chooses appropriate tools based on your questions

## How RAG (Retrieval-Augmented Generation) Works

This system implements a RAG architecture to enable question-answering over PDF documents. Here's how it works:

### **Phase 1: Document Processing & Storage** (Upload)

When you upload a PDF document:

1. **PDF Text Extraction**: PDF.js extracts text from each page of the PDF
2. **Text Chunking**: LangChain's RecursiveCharacterTextSplitter breaks the text into 400-character chunks with 50-character overlap
3. **Embedding Generation**: Each chunk is sent to Together.ai's `BAAI/bge-base-en-v1.5-vllm` model to create vector embeddings (numerical representations of semantic meaning)
4. **Storage**: Both the text chunks and their embeddings are stored in Firestore for later retrieval

### **Phase 2: Question Answering** (Chat)

When you ask a question:

1. **Query Embedding**: Your question is sent to the **same embedding model** (`BAAI/bge-base-en-v1.5-vllm`) to create a vector representation
2. **Similarity Search**: The system compares your question vector to all stored chunk vectors using cosine similarity:
   - Cosine similarity measures the angle between vectors
   - Closer angles = more semantically similar content
   - Returns the top K (default 8) most relevant chunks
3. **Context Assembly**: The most relevant chunks are combined into a context string like:
   ```
   [#1 p.5] This chunk talks about machine learning algorithms...
   [#2 p.12] Another relevant section about neural networks...
   [#3 p.8] More context about AI applications...
   ```
4. **Answer Generation**: The context + your question is sent to OpenRouter's LLaMA 3.1-70B model with instructions to answer ONLY using the provided context

### **Why This Works**

- **Same Embedding Space**: Documents and queries use the same model, so semantically similar content has similar vectors
- **Semantic Search**: Vector similarity finds relevant content even when exact words don't match
- **Focused Context**: Only the most relevant chunks are sent to the LLM, keeping responses focused and accurate
- **Grounded Responses**: The LLM can only use retrieved context, preventing hallucination

**Example**: If you ask "How does machine learning work?", the embedding captures the semantic meaning, finds chunks about ML concepts from your uploaded documents, and the LLM synthesizes an answer using only those specific sections.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Angular Frontend                         │
│  ┌───────────────┐ ┌──────────────┐ ┌────────────────────────┐  │
│  │ Multi-Modal   │ │ PDF/Document │ │      Chat Interface    │  │
│  │ Chat UI       │ │ Processing   │ │   (Sessions & MCP)     │  │
│  │ (Text/Vision) │ │ (PDF.js +    │ │                        │  │
│  │               │ │  LangChain)  │ │                        │  │
│  └───────────────┘ └──────────────┘ └────────────────────────┘  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │ Firebase SDK + HTTP
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                     Firebase Services                           │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌─────────────────────────┐ │
│  │   Auth  │ │ Firestore│ │ Storage │ │      Functions          │ │
│  │         │ │ (chunks +│ │(PDFs +  │ │ ┌─────────┐ ┌─────────┐ │ │
│  │         │ │embeddings│ │ images) │ │ │Chat/RAG │ │6x MCP   │ │ │
│  │         │ │+ chats)  │ │         │ │ │Functions│ │Servers  │ │ │
│  └─────────┘ └──────────┘ └─────────┘ └─┴─────────┘ └─────────┘─┘ │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │ HTTP API calls
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                    External APIs                                │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────────────┐ │
│  │ Together.ai │ │ OpenRouter  │ │        MCP Data Sources      │ │
│  │ (BGE-M3     │ │ (LLaMA 3.1  │ │ ┌──────────┐ ┌─────────────┐ │ │
│  │ Embeddings) │ │ 70B + Vision│ │ │OpenMeteo │ │Yahoo Finance│ │ │
│  └─────────────┘ └─────────────┘ │ │(Weather) │ │  (Stocks)   │ │ │
│                                  │ └──────────┘ └─────────────┘ │ │
│                                  │ ┌──────────┐ ┌─────────────┐ │ │
│                                  │ │Frankfurter│ │Mathematical │ │ │
│                                  │ │(Currency) │ │ Libraries   │ │ │
│                                  │ └──────────┘ └─────────────┘ │ │
│                                  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Data Models

### Firestore Collections

- `/documents/{docId}` - Document metadata
  - `/chunks/{chunkId}` - Text chunks with embeddings
- `/sessions/{sessionId}` - Chat sessions  
  - `/messages/{messageId}` - Chat messages with sources

### Storage Structure

- `/documents/{userId}/{timestamp}_{filename}.pdf` - Original PDF files

## Deployment

1. **Deploy to Firebase:**
   ```bash
   npm run deploy
   ```
   This will:
   - Generate production environment files from templates
   - Build the Angular app for production
   - Build the Firebase Functions
   - Deploy everything to Firebase

   **Note**: Make sure you have set up Firebase Functions secrets first:
   ```bash
   firebase functions:secrets:set TOGETHER_API_KEY
   firebase functions:secrets:set OPENROUTER_API_KEY
   ```

## Environment Variables

Create a `.env` file with:

```env
# Firebase Configuration (already set)
FIREBASE_API_KEY=your_api_key
FIREBASE_AUTH_DOMAIN=your_domain
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_bucket
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
FIREBASE_MEASUREMENT_ID=your_measurement_id

# External API Keys (add these)
TOGETHER_API_KEY=your_together_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
```

Acknowldegments:
The Weather MCP server uses OpenMeteo APIs and was implemented by me. 

The following MCP servers have been converted to Node and are acknowledged as follows: 

Calculator MCP Server: 
https://github.com/huhabla/calculator-mcp-server

Yahoo Finance API MCP Server: 
https://github.com/9nate-drake/mcp-yfinance

Currency Conversion MCP Server: 
https://github.com/wesbos/currency-conversion-mcp/tree/main?tab=readme-ov-file

Unit Conversion MCP Server: 
https://github.com/zazencodes/unit-converter-mcp

Time Conversion MCP Server: 
https://github.com/modelcontextprotocol/servers/blob/main/src/time/README.md