import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { PdfProcessorService, ChunkData } from '../../services/pdf-processor.service';
import { DocumentService, DocumentData } from '../../services/document.service';
import { ChatService, ChatSession, ChatMessage } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { GlobalModelSelectionService } from '../../services/global-model-selection.service';
import { RAGModelSelection } from '../../services/models-config.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  // Document Management
  documents: DocumentData[] = [];
  selectedDocument: DocumentData | null = null;
  uploading = false;
  uploadProgress = '';

  // Chat
  sessions: ChatSession[] = [];
  currentSession: ChatSession | null = null;
  messages: ChatMessage[] = [];
  messageInput = '';
  sending = false;

  // UI State
  activeTab: 'documents' | 'chat' = 'documents';
  dragOver = false;

  constructor(
    private pdfProcessor: PdfProcessorService,
    private documentService: DocumentService,
    private chatService: ChatService,
    private authService: AuthService,
    private globalModelSelection: GlobalModelSelectionService
  ) {}

  ngOnInit() {
    this.loadUserData();
  }

  async loadUserData() {
    try {
      this.documents = await this.documentService.getUserDocuments();
      this.sessions = await this.chatService.getUserSessions();
      
      if (this.sessions.length > 0 && !this.currentSession) {
        await this.selectSession(this.sessions[0]);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  }

  // File Upload Handling
  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.dragOver = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.dragOver = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragOver = false;
    
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  onFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  async handleFile(file: File) {
    if (file.type !== 'application/pdf') {
      alert('Please select a PDF file.');
      return;
    }

    if (file.size > 50 * 1024 * 1024) { // 50MB limit
      alert('File size must be less than 50MB.');
      return;
    }

    this.uploading = true;
    this.uploadProgress = 'Uploading file...';

    try {
      // 1. Upload PDF to Storage
      const docId = await this.documentService.uploadPdf(file);
      this.uploadProgress = 'Processing PDF...';

      // 2. Process PDF locally
      const chunks = await this.pdfProcessor.processPdfFile(file);
      this.uploadProgress = `Generating embeddings for ${chunks.length} chunks...`;

      // 3. Generate embeddings and save to Firestore
      await this.documentService.saveChunksWithEmbeddings(docId, chunks);
      this.uploadProgress = 'Finalizing...';

      // 4. Update document status
      await this.documentService.updateDocumentStatus(docId, 'completed', chunks.length);

      this.uploadProgress = 'Complete!';
      
      // Refresh documents list
      await this.loadUserData();
      
    } catch (error) {
      console.error('Error processing file:', error);
      this.uploadProgress = 'Error processing file. Please try again.';
    } finally {
      this.uploading = false;
      setTimeout(() => {
        this.uploadProgress = '';
      }, 2000);
    }
  }

  selectDocument(doc: DocumentData) {
    this.selectedDocument = doc;
  }

  // Chat Handling
  async createNewSession() {
    try {
      const sessionId = await this.chatService.createSession();
      await this.loadUserData();
      
      const newSession = this.sessions.find(s => s.id === sessionId);
      if (newSession) {
        await this.selectSession(newSession);
      }
      this.activeTab = 'chat';
    } catch (error) {
      console.error('Error creating session:', error);
    }
  }

  async selectSession(session: ChatSession) {
    this.currentSession = session;
    try {
      this.messages = await this.chatService.getSessionMessages(session.id!);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }

  async sendMessage() {
    if (!this.messageInput.trim() || !this.currentSession || this.sending) {
      return;
    }

    const messageText = this.messageInput.trim();
    this.messageInput = '';
    this.sending = true;

    // Add user message to UI immediately
    const userMessage: ChatMessage = {
      role: 'user',
      content: messageText,
      createdAt: new Date()
    };
    this.messages.push(userMessage);

    try {
      const response = await this.chatService.sendMessage(
        this.currentSession.id!,
        messageText,
        this.selectedDocument?.id,
        this.globalModelSelection.getSelectionForRequest()
      );
      
      // Replace or add the assistant message
      this.messages.push(response);
      
    } catch (error) {
      console.error('Error sending message:', error);
      // Add error message
      this.messages.push({
        role: 'assistant',
        content: 'Sorry, there was an error processing your message. Please try again.',
        createdAt: new Date()
      });
    } finally {
      this.sending = false;
    }
  }

  onEnterKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }


  setActiveTab(tab: 'documents' | 'chat') {
    this.activeTab = tab;
  }
}