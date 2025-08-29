import { Injectable } from '@angular/core';

export interface ErrorContext {
  operation: string;
  details?: any;
  userId?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ErrorHandlerService {

  constructor() { }

  /**
   * Extracts user-friendly error message from Firebase function errors
   */
  extractErrorMessage(error: any): string {
    if (error && typeof error === 'object' && 'message' in error) {
      return error.message;
    }
    return 'An unexpected error occurred. Please try again.';
  }

  /**
   * Handles Firebase function errors with consistent logging and user feedback
   */
  handleFirebaseError(error: any, context: ErrorContext): string {
    const errorMessage = this.extractErrorMessage(error);
    
    console.error(`Error in ${context.operation}:`, {
      error,
      context: context.details,
      userId: context.userId,
      timestamp: new Date().toISOString()
    });

    return errorMessage;
  }

  /**
   * Creates standardized error response for chat operations
   */
  createChatErrorMessage(error: any, operation: 'RAG' | 'General' | 'Vision' | 'MCP'): string {
    const baseMessage = this.extractErrorMessage(error);
    
    const operationMessages = {
      'RAG': 'Sorry, there was an error processing your message. Please try again.',
      'General': 'Sorry, there was an error processing your message. Please try again.',
      'Vision': 'Sorry, there was an error analyzing your image. Please try again.',
      'MCP': 'Sorry, I encountered an error processing your message. Please try again.'
    };

    // Use extracted message if it's user-friendly, otherwise use default
    if (baseMessage && !baseMessage.includes('internal') && !baseMessage.includes('undefined')) {
      return baseMessage;
    }

    return operationMessages[operation];
  }

  /**
   * Handles document operation errors
   */
  handleDocumentError(error: any, operation: 'upload' | 'delete' | 'process'): string {
    const operationMessages = {
      'upload': 'Error processing file. Please try again.',
      'delete': 'Failed to delete document. Please try again.',
      'process': 'Error processing document. Please try again.'
    };

    console.error(`Document ${operation} error:`, error);
    return this.extractErrorMessage(error) || operationMessages[operation];
  }

  /**
   * Handles session operation errors
   */
  handleSessionError(error: any, operation: 'create' | 'delete' | 'load'): string {
    const operationMessages = {
      'create': 'Error creating session. Please try again.',
      'delete': 'Failed to delete session. Please try again.',
      'load': 'Error loading session data. Please try again.'
    };

    console.error(`Session ${operation} error:`, error);
    return this.extractErrorMessage(error) || operationMessages[operation];
  }
}