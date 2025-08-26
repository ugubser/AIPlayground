import { Injectable } from '@angular/core';
import { Firestore, collection, doc, addDoc, getDocs, query, where, orderBy, Timestamp } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { DynamicModelSelection } from './models-config.service';

export interface ChatSession {
  id?: string;
  uid: string;
  title: string;
  createdAt: Date;
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
  }, { answer: string }>(this.functions, 'generalChat');

  private visionChat = httpsCallable<{
    message: string;
    imageData: string;
  }, { answer: string }>(this.functions, 'visionChat');

  constructor(
    private firestore: Firestore,
    private functions: Functions,
    private auth: Auth
  ) { }

  async createSession(title?: string): Promise<string> {
    if (!this.auth.currentUser) {
      throw new Error('User not authenticated');
    }

    const uid = this.auth.currentUser.uid;
    const sessionData: Omit<ChatSession, 'id'> = {
      uid,
      title: title || `Chat ${new Date().toLocaleString()}`,
      createdAt: new Date()
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

    const uid = this.auth.currentUser.uid;

    // Save user message
    const userMessage: Omit<ChatMessage, 'id'> = {
      role: 'user',
      content: message,
      createdAt: new Date()
    };

    const userMessageRef = await addDoc(
      collection(this.firestore, `sessions/${sessionId}/messages`),
      userMessage
    );

    try {
      // Get RAG response with model configuration
      const ragRequest: any = {
        sessionId,
        message,
        k: 8,
        restrictDocId
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

      // Save assistant message
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

      return {
        id: assistantMessageRef.id,
        ...assistantMessage
      };

    } catch (error) {
      console.error('Error getting RAG response:', error);
      
      // Save error message
      const errorMessage: Omit<ChatMessage, 'id'> = {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your question. Please try again.',
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
        message
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

      return {
        role: 'assistant',
        content: data.answer,
        createdAt: new Date()
      };

    } catch (error) {
      console.error('Error getting general chat response:', error);
      
      return {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your question. Please try again.',
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
        imageData
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

      return {
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
}