import { Injectable } from '@angular/core';
import { Firestore, collection, doc, addDoc, getDocs, query, where, orderBy, Timestamp, updateDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { DynamicModelSelection } from './models-config.service';
import { McpService } from './mcp.service';
import { McpRegistryService, McpToolCall } from './mcp-registry.service';
import { PromptLoggingService } from './prompt-logging.service';

export interface ChatSession {
  id?: string;
  uid: string;
  title: string;
  createdAt: Date;
  associatedDocuments?: string[]; // Array of document IDs
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  createdAt: Date;
}

export interface ChatSource {
  docId: string;
  chunkId: string;
  page: number;
  score: number;
  label: string;
}

export interface ChatResponse {
  answer: string;
  sources?: ChatSource[];
  promptData?: any;
}

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private chatRag = httpsCallable<{
    sessionId: string;
    message: string;
    k?: number;
    restrictDocId?: string;
  }, ChatResponse>(this.functions, 'chatRag');

  private generalChat = httpsCallable<{
    message: string;
  }, { answer: string; promptData?: any }>(this.functions, 'generalChat');

  private visionChat = httpsCallable<{
    message: string;
    imageData: string;
  }, { answer: string; promptData?: any }>(this.functions, 'visionChat');

  private mcpChat = httpsCallable<{
    message: string;
    tools?: any[];
    llmProvider?: string;
    llmModel?: string;
  }, { answer: string; toolCalls?: any[]; promptData?: any }>(this.functions, 'mcpChat');

  constructor(
    private firestore: Firestore,
    private functions: Functions,
    private auth: Auth,
    private mcpService: McpService,
    private mcpRegistry: McpRegistryService,
    private promptLogging: PromptLoggingService
  ) { }

  async createSession(title?: string, associatedDocuments?: string[]): Promise<string> {
    if (!this.auth.currentUser) {
      throw new Error('User not authenticated');
    }

    const uid = this.auth.currentUser.uid;
    const sessionData: Omit<ChatSession, 'id'> = {
      uid,
      title: title || `Chat ${new Date().toLocaleString()}`,
      createdAt: new Date(),
      associatedDocuments: associatedDocuments || []
    };

    const sessionRef = await addDoc(collection(this.firestore, 'sessions'), sessionData);
    return sessionRef.id;
  }

  async getUserSessions(): Promise<ChatSession[]> {
    if (!this.auth.currentUser) {
      return [];
    }

    const uid = this.auth.currentUser.uid;
    const q = query(
      collection(this.firestore, 'sessions'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc')
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: (doc.data()['createdAt'] as Timestamp).toDate()
    } as ChatSession));
  }

  async getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    const q = query(
      collection(this.firestore, `sessions/${sessionId}/messages`),
      orderBy('createdAt', 'asc')
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: (doc.data()['createdAt'] as Timestamp).toDate()
    } as ChatMessage));
  }

  async sendMessage(sessionId: string, message: string, restrictDocId?: string, modelSelection?: DynamicModelSelection): Promise<ChatMessage> {
    if (!this.auth.currentUser) {
      throw new Error('User not authenticated');
    }

    // Save user message
    const userMessage: Omit<ChatMessage, 'id'> = {
      role: 'user',
      content: message,
      createdAt: new Date()
    };

    await addDoc(
      collection(this.firestore, `sessions/${sessionId}/messages`),
      userMessage
    );

    try {
      // Get RAG response with model configuration
      const ragRequest: any = {
        sessionId,
        message,
        k: 8,
        restrictDocId,
        enablePromptLogging: this.promptLogging.isLoggingActive()
      };

      // Add model selection if provided
      if (modelSelection) {
        if (modelSelection['llm']) {
          ragRequest.llmProvider = modelSelection['llm'].provider;
          ragRequest.llmModel = modelSelection['llm'].model;
        }
        if (modelSelection['embed']) {
          ragRequest.embedProvider = modelSelection['embed'].provider;
          ragRequest.embedModel = modelSelection['embed'].model;
        }
        console.log('Chat service sending RAG request with models:', {
          llmProvider: ragRequest.llmProvider,
          llmModel: ragRequest.llmModel,
          embedProvider: ragRequest.embedProvider,
          embedModel: ragRequest.embedModel
        });
      } else {
        console.log('Chat service: No model selection provided, using defaults');
      }

      const { data } = await this.chatRag(ragRequest);

      // Save assistant message first to get the ID
      const assistantMessage: Omit<ChatMessage, 'id'> = {
        role: 'assistant',
        content: data.answer,
        sources: data.sources,
        createdAt: new Date()
      };

      const assistantMessageRef = await addDoc(
        collection(this.firestore, `sessions/${sessionId}/messages`),
        assistantMessage
      );

      // Log prompt data if enabled, using the message ID
      if (this.promptLogging.isLoggingActive() && data.promptData) {
        if (data.promptData.embedRequest) {
          this.promptLogging.addPromptLog({
            type: 'request',
            provider: data.promptData.embedRequest.provider,
            model: data.promptData.embedRequest.model,
            content: data.promptData.embedRequest.content,
            timestamp: new Date(),
            sessionContext: 'rag',
            messageId: assistantMessageRef.id
          });
        }
        if (data.promptData.embedResponse) {
          this.promptLogging.addPromptLog({
            type: 'response',
            provider: data.promptData.embedResponse.provider,
            model: data.promptData.embedResponse.model,
            content: data.promptData.embedResponse.content,
            timestamp: new Date(),
            sessionContext: 'rag',
            messageId: assistantMessageRef.id
          });
        }
        if (data.promptData.searchData) {
          this.promptLogging.addPromptLog({
            type: 'response',
            provider: 'RAG Search',
            model: 'Document Search',
            content: this.formatSearchData(data.promptData.searchData),
            timestamp: new Date(),
            sessionContext: 'rag',
            messageId: assistantMessageRef.id
          });
        }
        if (data.promptData.llmRequest) {
          this.promptLogging.addPromptLog({
            type: 'request',
            provider: data.promptData.llmRequest.provider,
            model: data.promptData.llmRequest.model,
            content: data.promptData.llmRequest.content,
            timestamp: new Date(),
            sessionContext: 'rag',
            messageId: assistantMessageRef.id
          });
        }
        if (data.promptData.llmResponse) {
          this.promptLogging.addPromptLog({
            type: 'response',
            provider: data.promptData.llmResponse.provider,
            model: data.promptData.llmResponse.model,
            content: data.promptData.llmResponse.content,
            timestamp: new Date(),
            sessionContext: 'rag',
            messageId: assistantMessageRef.id
          });
        }
      }

      return {
        id: assistantMessageRef.id,
        ...assistantMessage
      };

    } catch (error) {
      console.error('Error getting RAG response:', error);
      
      // Extract Firebase function error message if available
      let errorContent = 'Sorry, I encountered an error processing your question. Please try again.';
      if (error && typeof error === 'object' && 'message' in error) {
        errorContent = (error as any).message;
      }
      
      // Save error message
      const errorMessage: Omit<ChatMessage, 'id'> = {
        role: 'assistant',
        content: errorContent,
        createdAt: new Date()
      };

      const errorMessageRef = await addDoc(
        collection(this.firestore, `sessions/${sessionId}/messages`),
        errorMessage
      );

      return {
        id: errorMessageRef.id,
        ...errorMessage
      };
    }
  }

  async sendGeneralMessage(message: string, modelSelection?: DynamicModelSelection): Promise<ChatMessage> {
    if (!this.auth.currentUser) {
      throw new Error('User not authenticated');
    }

    try {
      const generalRequest: any = {
        message,
        enablePromptLogging: this.promptLogging.isLoggingActive()
      };

      // Add model selection if provided
      if (modelSelection && modelSelection['llm']) {
        generalRequest.llmProvider = modelSelection['llm'].provider;
        generalRequest.llmModel = modelSelection['llm'].model;
        console.log('Chat service sending general request with models:', {
          llmProvider: generalRequest.llmProvider,
          llmModel: generalRequest.llmModel
        });
      } else {
        console.log('Chat service: No model selection provided for general chat, using defaults');
      }

      const { data } = await this.generalChat(generalRequest);

      // Generate a temporary message ID for general chat
      const messageId = `general_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Log prompt data if enabled, using the temporary message ID
      if (this.promptLogging.isLoggingActive() && data.promptData) {
        if (data.promptData.llmRequest) {
          this.promptLogging.addPromptLog({
            type: 'request',
            provider: data.promptData.llmRequest.provider,
            model: data.promptData.llmRequest.model,
            content: data.promptData.llmRequest.content,
            timestamp: new Date(),
            sessionContext: 'general',
            messageId: messageId
          });
        }
        if (data.promptData.llmResponse) {
          this.promptLogging.addPromptLog({
            type: 'response',
            provider: data.promptData.llmResponse.provider,
            model: data.promptData.llmResponse.model,
            content: data.promptData.llmResponse.content,
            timestamp: new Date(),
            sessionContext: 'general',
            messageId: messageId
          });
        }
      }

      return {
        id: messageId,
        role: 'assistant',
        content: data.answer,
        createdAt: new Date()
      };

    } catch (error) {
      console.error('Error getting general chat response:', error);
      
      // Extract Firebase function error message if available
      let errorContent = 'Sorry, I encountered an error processing your question. Please try again.';
      if (error && typeof error === 'object' && 'message' in error) {
        errorContent = (error as any).message;
      }
      
      return {
        role: 'assistant',
        content: errorContent,
        createdAt: new Date()
      };
    }
  }

  async sendVisionMessage(imageFile: File, prompt: string, modelSelection?: DynamicModelSelection): Promise<ChatMessage> {
    if (!this.auth.currentUser) {
      throw new Error('User not authenticated');
    }

    try {
      // Convert image file to base64
      const imageData = await this.fileToBase64(imageFile);

      const visionRequest: any = {
        message: prompt,
        imageData,
        enablePromptLogging: this.promptLogging.isLoggingActive()
      };

      // Add model selection if provided
      if (modelSelection && modelSelection['vision']) {
        visionRequest.visionProvider = modelSelection['vision'].provider;
        visionRequest.visionModel = modelSelection['vision'].model;
        console.log('Chat service sending vision request with models:', {
          visionProvider: visionRequest.visionProvider,
          visionModel: visionRequest.visionModel
        });
      } else {
        console.log('Chat service: No model selection provided for vision, using defaults');
      }

      const { data } = await this.visionChat(visionRequest);

      // Generate a temporary message ID for vision chat
      const messageId = `vision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Log prompt data if enabled, using the temporary message ID
      if (this.promptLogging.isLoggingActive() && data.promptData) {
        if (data.promptData.visionRequest) {
          this.promptLogging.addPromptLog({
            type: 'request',
            provider: data.promptData.visionRequest.provider,
            model: data.promptData.visionRequest.model,
            content: data.promptData.visionRequest.content,
            timestamp: new Date(),
            sessionContext: 'vision',
            messageId: messageId
          });
        }
        if (data.promptData.visionResponse) {
          this.promptLogging.addPromptLog({
            type: 'response',
            provider: data.promptData.visionResponse.provider,
            model: data.promptData.visionResponse.model,
            content: data.promptData.visionResponse.content,
            timestamp: new Date(),
            sessionContext: 'vision',
            messageId: messageId
          });
        }
      }

      return {
        id: messageId,
        role: 'assistant',
        content: data.answer,
        createdAt: new Date()
      };

    } catch (error) {
      console.error('Error getting vision response:', error);
      
      return {
        role: 'assistant',
        content: 'Sorry, I encountered an error analyzing your image. Please try again.',
        createdAt: new Date()
      };
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data:image/...;base64, prefix
        const base64Data = result.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async updateSessionDocuments(sessionId: string, documentIds: string[]): Promise<void> {
    const sessionRef = doc(this.firestore, `sessions/${sessionId}`);
    await updateDoc(sessionRef, { associatedDocuments: documentIds });
  }

  async addDocumentToSession(sessionId: string, documentId: string): Promise<void> {
    const sessionRef = doc(this.firestore, `sessions/${sessionId}`);
    const sessionDoc = await getDocs(query(collection(this.firestore, 'sessions'), where('__name__', '==', sessionId)));
    
    if (!sessionDoc.empty) {
      const currentSession = sessionDoc.docs[0].data() as ChatSession;
      const currentDocs = currentSession.associatedDocuments || [];
      
      if (!currentDocs.includes(documentId)) {
        const updatedDocs = [...currentDocs, documentId];
        await updateDoc(sessionRef, { associatedDocuments: updatedDocs });
      }
    }
  }

  async removeDocumentFromSession(sessionId: string, documentId: string): Promise<void> {
    const sessionRef = doc(this.firestore, `sessions/${sessionId}`);
    const sessionDoc = await getDocs(query(collection(this.firestore, 'sessions'), where('__name__', '==', sessionId)));
    
    if (!sessionDoc.empty) {
      const currentSession = sessionDoc.docs[0].data() as ChatSession;
      const currentDocs = currentSession.associatedDocuments || [];
      
      const updatedDocs = currentDocs.filter(docId => docId !== documentId);
      await updateDoc(sessionRef, { associatedDocuments: updatedDocs });
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.auth.currentUser) {
      throw new Error('User not authenticated');
    }

    const deleteSessionFunc = httpsCallable<{sessionId: string}, {success: boolean}>(this.functions, 'deleteSession');
    await deleteSessionFunc({ sessionId });
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    const sessionRef = doc(this.firestore, `sessions/${sessionId}`);
    await updateDoc(sessionRef, { title });
  }

  async sendMcpMessage(message: string, modelSelection?: DynamicModelSelection, toolResults?: any[], conversationMessageId?: string): Promise<{ answer: string; toolCalls?: { name: string; arguments: Record<string, any> }[]; messageId?: string }> {
    if (!this.auth.currentUser) {
      throw new Error('User not authenticated');
    }

    try {
      const mcpRequest: any = {
        message,
        enablePromptLogging: this.promptLogging.isLoggingActive()
      };

      // Add tools only on initial request (not follow-up)
      if (!toolResults) {
        const tools = this.mcpRegistry.getAvailableTools();
        mcpRequest.tools = tools;
        console.log('💬 MCP Chat: Available tools for LLM:', tools.length, tools.map(t => t.name));
      } else {
        // This is a follow-up request with tool results
        mcpRequest.toolResults = toolResults;
      }

      // Add model selection if provided
      if (modelSelection && modelSelection['llm']) {
        mcpRequest.llmProvider = modelSelection['llm'].provider;
        mcpRequest.llmModel = modelSelection['llm'].model;
        console.log('Chat service sending MCP request:', {
          llmProvider: mcpRequest.llmProvider,
          llmModel: mcpRequest.llmModel,
          isFollowUp: !!toolResults,
          toolCount: mcpRequest.tools?.length || 0
        });
      }

      const { data } = await this.mcpChat(mcpRequest);

      // Use provided conversation message ID or generate a temporary one for MCP chat
      const messageId = conversationMessageId || `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

      // Log prompt data if enabled, using the consistent message ID
      if (this.promptLogging.isLoggingActive() && data.promptData) {
        if (data.promptData.llmRequest) {
          this.promptLogging.addPromptLog({
            type: 'request',
            provider: data.promptData.llmRequest.provider,
            model: data.promptData.llmRequest.model,
            content: data.promptData.llmRequest.content,
            timestamp: new Date(),
            sessionContext: 'mcp',
            messageId: messageId
          });
        }
        if (data.promptData.llmResponse) {
          this.promptLogging.addPromptLog({
            type: 'response',
            provider: data.promptData.llmResponse.provider,
            model: data.promptData.llmResponse.model,
            content: data.promptData.llmResponse.content,
            timestamp: new Date(),
            sessionContext: 'mcp',
            messageId: messageId
          });
        }
      }

      return {
        answer: data.answer,
        toolCalls: data.toolCalls as { name: string; arguments: Record<string, any> }[],
        messageId: messageId
      };

    } catch (error) {
      console.error('Error getting MCP chat response:', error);
      throw error;
    }
  }

  private formatSearchData(searchData: any): string {
    const {
      totalChunks,
      compatibleChunks,
      topChunks,
      contextLength,
      documentsUsed
    } = searchData;

    let result = `🔍 **Document Search Results**\n\n`;
    result += `📊 **Search Summary:**\n`;
    result += `• Total chunks found: ${totalChunks}\n`;
    result += `• Compatible chunks: ${compatibleChunks}\n`;
    result += `• Documents used: ${documentsUsed}\n`;
    result += `• Context length: ${contextLength.toLocaleString()} characters\n\n`;

    result += `🎯 **Top Matches Used:**\n`;
    topChunks.forEach((chunk: any, index: number) => {
      const score = Math.round(chunk.score * 100);
      result += `${index + 1}. Page ${chunk.page} (${score}% match)\n`;
      result += `   📄 "${chunk.preview}"\n\n`;
    });

    return result;
  }
}