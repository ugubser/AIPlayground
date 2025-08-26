# Firebase RAG Chatbot

A Retrieval-Augmented Generation (RAG) chatbot built with Angular, Firebase, Together.ai for embeddings, and OpenRouter for chat completions. Upload PDF documents and ask questions about their content.

## Features

- 📄 PDF document upload and processing
- 🤖 RAG-powered question answering
- 💬 Multi-session chat interface
- 🔒 Secure authentication (anonymous)
- 🗄️ Document and chat history management
- 🚀 Firebase emulator support for local development

## Tech Stack

- **Frontend**: Angular 17 with standalone components
- **Backend**: Firebase (Auth, Firestore, Storage, Functions, Hosting)
- **PDF Processing**: PDF.js + LangChain.js text splitters
- **Embeddings**: Together.ai (BAAI/bge-m3 model)
- **LLM**: OpenRouter (Llama 3.1 70B Instruct)
- **Development**: Firebase emulators

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

1. **Sign in** (anonymous authentication)
2. **Upload PDFs** on the Documents tab
3. **Start chatting** - create a new chat session
4. **Filter by document** to ask questions about specific files
5. **View sources** - see which document chunks were used to answer questions

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
┌─────────────────────────────────────────────────────┐
│                   Angular Frontend                  │
│  ┌─────────────────┐  ┌────────────────────────────┐ │
│  │  PDF Processing │  │         Chat UI            │ │
│  │   (PDF.js +     │  │  (Sessions & Messages)    │ │
│  │   LangChain)    │  │                            │ │
│  └─────────────────┘  └────────────────────────────┘ │
└─────────────────┬───────────────────────────────────┘
                  │
                  │ Firebase SDK
                  │
┌─────────────────▼───────────────────────────────────┐
│                Firebase Services                    │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌────────────┐ │
│  │   Auth  │ │ Firestore│ │ Storage │ │ Functions  │ │
│  │         │ │ (chunks + │ │ (PDFs)  │ │(embedChunks│ │
│  │         │ │embeddings)│ │         │ │ & chatRag) │ │
│  └─────────┘ └──────────┘ └─────────┘ └────────────┘ │
└─────────────────┬───────────────────────────────────┘
                  │
                  │ HTTP API calls
                  │
┌─────────────────▼───────────────────────────────────┐
│              External APIs                          │
│  ┌─────────────────┐      ┌─────────────────────────┐ │
│  │   Together.ai   │      │      OpenRouter        │ │
│  │ BAAI/bge-base-  │      │ meta-llama/llama-3.1-  │ │
│  │ en-v1.5-vllm    │      │ 70b-instruct           │ │
│  │ (Embeddings)    │      │ (Chat Completion)      │ │
│  └─────────────────┘      └─────────────────────────┘ │
└─────────────────────────────────────────────────────┘
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

## Troubleshooting

- **Emulator connection issues**: Check that all emulators are running and ports are available
- **PDF processing errors**: Ensure PDF files are valid and under 50MB
- **Embedding failures**: Verify Together.ai API key is set correctly
- **Chat errors**: Check OpenRouter API key and model availability
- **CORS issues**: Make sure to use emulators for local development

## Next Steps

- Add user authentication (email/password, Google, etc.)
- Implement document search and filtering
- Add support for more file types (Word, PowerPoint, etc.)  
- Implement conversation memory and context
- Add file sharing between users
- Performance optimizations for large document collections
