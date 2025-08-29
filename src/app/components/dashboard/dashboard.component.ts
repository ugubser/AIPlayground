import { Component, OnInit, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { PdfProcessorService, ChunkData } from '../../services/pdf-processor.service';
import { DocumentService, DocumentData } from '../../services/document.service';
import { ChatService, ChatSession, ChatMessage } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { GlobalModelSelectionService } from '../../services/global-model-selection.service';
import { DynamicModelSelection } from '../../services/models-config.service';
import { McpService } from '../../services/mcp.service';
import { McpRegistryService, McpServerConfig, McpTool } from '../../services/mcp-registry.service';

interface VisionMessage {
  role: 'user' | 'assistant';
  content?: string;
  image?: { url: string; name: string };
  prompt?: string;
  createdAt: Date;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  // ViewChild references for auto-scroll
  @ViewChild('ragMessagesContainer') ragMessagesContainer!: ElementRef;
  @ViewChild('generalMessagesContainer') generalMessagesContainer!: ElementRef;
  @ViewChild('visionMessagesContainer') visionMessagesContainer!: ElementRef;

  // Document Management
  documents: DocumentData[] = [];
  selectedDocument: DocumentData | null = null;
  uploading = false;
  uploadProgress = '';
  deleting: string | null = null;
  deletingSession: string | null = null;

  // RAG Chat (document-based)
  sessions: ChatSession[] = [];
  currentSession: ChatSession | null = null;
  messages: ChatMessage[] = [];
  messageInput = '';
  sending = false;

  // General Chat (no documents)
  generalMessages: ChatMessage[] = [];
  generalMessageInput = '';
  sendingGeneral = false;

  // MCP (Model Context Protocol) settings
  mcpEnabled = false;
  mcpServers: McpServerConfig[] = [];
  availableTools: McpTool[] = [];

  // UI State
  activeTab: 'rag' | 'chat' | 'vision' = 'rag';
  dragOver = false;
  showAddDocuments = false;

  // Vision functionality
  selectedImage: { url: string; name: string; size: number; file: File } | null = null;
  visionDragOver = false;
  visionUploading = false;
  visionPrompt = '';
  sendingVision = false;
  visionMessages: VisionMessage[] = [];

  constructor(
    private pdfProcessor: PdfProcessorService,
    private documentService: DocumentService,
    private chatService: ChatService,
    private authService: AuthService,
    private globalModelSelection: GlobalModelSelectionService,
    private mcpService: McpService,
    private mcpRegistry: McpRegistryService
  ) {}

  private scrollToBottom(container: ElementRef, smooth: boolean = true) {
    try {
      const element = container.nativeElement;
      const scrollOptions: ScrollToOptions = {
        top: element.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      };
      element.scrollTo(scrollOptions);
    } catch (error) {
      // Fallback for browsers that don't support smooth scrolling
      try {
        const element = container.nativeElement;
        element.scrollTop = element.scrollHeight;
      } catch (fallbackError) {
        console.debug('Auto-scroll failed:', fallbackError);
      }
    }
  }

  private scrollToBottomAfterDelay(container: ElementRef, delay: number = 100) {
    setTimeout(() => {
      this.scrollToBottom(container);
    }, delay);
  }

  ngOnInit() {
    this.loadUserData();
    this.initializeMcpRegistry();
  }

  private initializeMcpRegistry() {
    // Subscribe to MCP registry updates
    this.mcpRegistry.servers$.subscribe(servers => {
      this.mcpServers = servers;
    });

    this.mcpRegistry.availableTools$.subscribe(tools => {
      this.availableTools = tools;
    });
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

      // 5. Associate document with current session if one exists
      if (this.currentSession?.id) {
        await this.chatService.addDocumentToSession(this.currentSession.id, docId);
        console.log(`Associated document ${docId} with session ${this.currentSession.id}`);
        
        // Update current session's associated documents immediately
        if (!this.currentSession.associatedDocuments) {
          this.currentSession.associatedDocuments = [];
        }
        this.currentSession.associatedDocuments.push(docId);
      }

      this.uploadProgress = 'Complete!';
      
      // Refresh documents list
      await this.loadUserData();
      
      // Force UI refresh by re-selecting current session
      if (this.currentSession?.id) {
        const updatedSession = this.sessions.find(s => s.id === this.currentSession!.id);
        if (updatedSession) {
          this.currentSession = updatedSession;
        }
      }
      
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
      // Don't switch tabs - stay on current tab
    } catch (error) {
      console.error('Error creating session:', error);
    }
  }

  async selectSession(session: ChatSession) {
    this.currentSession = session;
    try {
      this.messages = await this.chatService.getSessionMessages(session.id!);
      // Scroll to bottom to show latest messages after loading
      if (this.messages.length > 0) {
        this.scrollToBottomAfterDelay(this.ragMessagesContainer, 200);
      }
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
    
    // Scroll to show the user message
    this.scrollToBottomAfterDelay(this.ragMessagesContainer);

    try {
      // Check if this is the first message in the session (excluding the user message we just added)
      const isFirstMessage = this.messages.length === 1;
      
      const response = await this.chatService.sendMessage(
        this.currentSession.id!,
        messageText,
        this.selectedDocument?.id,
        this.globalModelSelection.getSelectionForRequest()
      );
      
      // Update session title if this is the first question
      if (isFirstMessage && this.currentSession) {
        const abbreviatedTitle = this.abbreviateTitle(messageText);
        await this.chatService.updateSessionTitle(this.currentSession.id!, abbreviatedTitle);
        
        // Update local session title
        this.currentSession.title = abbreviatedTitle;
        
        // Update in sessions list
        const sessionIndex = this.sessions.findIndex(s => s.id === this.currentSession!.id);
        if (sessionIndex !== -1) {
          this.sessions[sessionIndex].title = abbreviatedTitle;
        }
      }
      
      // Replace or add the assistant message
      this.messages.push(response);
      
      // Scroll to show the assistant response
      this.scrollToBottomAfterDelay(this.ragMessagesContainer);
      
    } catch (error) {
      console.error('Error sending message:', error);
      // Add error message
      this.messages.push({
        role: 'assistant',
        content: 'Sorry, there was an error processing your message. Please try again.',
        createdAt: new Date()
      });
      
      // Scroll to show the error message
      this.scrollToBottomAfterDelay(this.ragMessagesContainer);
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


  async sendGeneralMessage() {
    if (!this.generalMessageInput.trim() || this.sendingGeneral) {
      return;
    }

    const messageText = this.generalMessageInput.trim();
    this.generalMessageInput = '';
    this.sendingGeneral = true;

    // Add user message to UI immediately
    const userMessage: ChatMessage = {
      role: 'user',
      content: messageText,
      createdAt: new Date()
    };
    this.generalMessages.push(userMessage);
    
    // Scroll to show the user message
    this.scrollToBottomAfterDelay(this.generalMessagesContainer);

    try {
      let response: ChatMessage;
      
      if (this.mcpEnabled) {
        // Use MCP-enabled chat with tool calling capability
        response = await this.sendMcpMessage(messageText);
      } else {
        // Use regular general chat
        response = await this.chatService.sendGeneralMessage(
          messageText,
          this.globalModelSelection.getSelectionForRequest()
        );
      }
      
      this.generalMessages.push(response);
      
      // Scroll to show the assistant response
      this.scrollToBottomAfterDelay(this.generalMessagesContainer);
      
    } catch (error) {
      console.error('Error sending general message:', error);
      this.generalMessages.push({
        role: 'assistant',
        content: 'Sorry, there was an error processing your message. Please try again.',
        createdAt: new Date()
      });
      
      // Scroll to show the error message
      this.scrollToBottomAfterDelay(this.generalMessagesContainer);
    } finally {
      this.sendingGeneral = false;
    }
  }

  private async sendMcpMessage(message: string): Promise<ChatMessage> {
    try {
      // Get current selection and extract MCP provider/model if available
      const currentSelection = this.globalModelSelection.getSelectionForRequest();
      let mcpModelSelection = currentSelection;
      
      // If we have an MCP selection in the current selection, use it for LLM
      if (currentSelection && currentSelection['mcp']) {
        mcpModelSelection = {
          llm: {
            provider: currentSelection['mcp'].provider,
            model: currentSelection['mcp'].model
          }
        };
        console.log('Using MCP provider for tool calling:', mcpModelSelection);
      }
      
      // Step 1: Send message to LLM with available tools
      const mcpResponse = await this.chatService.sendMcpMessage(
        message,
        mcpModelSelection
      );
      
      // Step 2: If LLM requested tool calls, execute them and get final response
      if (mcpResponse.toolCalls && mcpResponse.toolCalls.length > 0) {
        console.log('LLM requested tool calls:', mcpResponse.toolCalls);
        
        const toolResults: any[] = [];
        
        for (const toolCall of mcpResponse.toolCalls) {
          try {
            console.log('Executing tool call:', toolCall);
            const result = await this.mcpService.callTool(toolCall);
            const toolOutput = result.content.map(c => c.text).join(' ');
            
            toolResults.push({
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              result: toolOutput
            });
          } catch (toolError) {
            console.error('Tool call error:', toolError);
            toolResults.push({
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              result: `Error: ${toolError}`
            });
          }
        }
        
        // Step 3: Send tool results back to LLM for final contextual response
        const finalResponse = await this.chatService.sendMcpMessage(
          message,
          mcpModelSelection,
          toolResults
        );
        
        return {
          role: 'assistant',
          content: finalResponse.answer,
          createdAt: new Date()
        };
      }
      
      // No tool calls, return LLM response directly
      return {
        role: 'assistant',
        content: mcpResponse.answer,
        createdAt: new Date()
      };
      
    } catch (error) {
      console.error('MCP message error:', error);
      return {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your message. Please try again.',
        createdAt: new Date()
      };
    }
  }


  onGeneralEnterKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendGeneralMessage();
    }
  }

  setActiveTab(tab: 'rag' | 'chat' | 'vision') {
    this.activeTab = tab;
    
    // Update global app context for model selector
    let appName = 'rag';
    if (tab === 'chat') appName = 'chat';
    else if (tab === 'vision') appName = 'vision';
    
    this.globalModelSelection.updateCurrentApp(appName);
  }

  // Vision functionality methods
  onVisionDragOver(event: DragEvent) {
    event.preventDefault();
    this.visionDragOver = true;
  }

  onVisionDragLeave(event: DragEvent) {
    event.preventDefault();
    this.visionDragOver = false;
  }

  onVisionDrop(event: DragEvent) {
    event.preventDefault();
    this.visionDragOver = false;
    
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleImageFile(files[0]);
    }
  }

  onImageSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleImageFile(input.files[0]);
    }
  }

  handleImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      alert('Image size must be less than 10MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.selectedImage = {
        url: e.target?.result as string,
        name: file.name,
        size: file.size,
        file: file
      };
    };
    reader.readAsDataURL(file);
  }

  clearSelectedImage() {
    this.selectedImage = null;
    this.visionPrompt = '';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async analyzeImage() {
    if (!this.selectedImage || this.sendingVision) {
      return;
    }

    this.sendingVision = true;
    const prompt = this.visionPrompt.trim() || 'Please analyze this image and describe what you see.';

    // Add user message
    const userMessage: VisionMessage = {
      role: 'user',
      image: { url: this.selectedImage.url, name: this.selectedImage.name },
      prompt: prompt,
      createdAt: new Date()
    };
    this.visionMessages.push(userMessage);
    
    // Scroll to show the user message
    this.scrollToBottomAfterDelay(this.visionMessagesContainer);

    try {
      // Use the chat service to send vision message
      const response = await this.chatService.sendVisionMessage(
        this.selectedImage.file,
        prompt,
        this.globalModelSelection.getSelectionForRequest()
      );
      
      // Add assistant response
      const assistantMessage: VisionMessage = {
        role: 'assistant',
        content: response.content,
        createdAt: new Date()
      };
      this.visionMessages.push(assistantMessage);
      
      // Scroll to show the assistant response
      this.scrollToBottomAfterDelay(this.visionMessagesContainer);
      
      // Clear the prompt for next use
      this.visionPrompt = '';
      
    } catch (error) {
      console.error('Error analyzing image:', error);
      // Add error message
      this.visionMessages.push({
        role: 'assistant',
        content: 'Sorry, there was an error analyzing your image. Please try again.',
        createdAt: new Date()
      });
      
      // Scroll to show the error message
      this.scrollToBottomAfterDelay(this.visionMessagesContainer);
    } finally {
      this.sendingVision = false;
    }
  }

  async deleteDocument(doc: DocumentData) {
    if (!doc.id || this.deleting) {
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete "${doc.filename}"? This will remove the document and all its associated data permanently.`);
    if (!confirmed) {
      return;
    }

    this.deleting = doc.id;

    try {
      await this.documentService.deleteDocument(doc.id);
      
      // Remove from local documents list
      this.documents = this.documents.filter(d => d.id !== doc.id);
      
      // Clear selection if this document was selected
      if (this.selectedDocument?.id === doc.id) {
        this.selectedDocument = null;
      }
      
      // Refresh data to ensure consistency
      await this.loadUserData();
      
    } catch (error) {
      console.error('Error deleting document:', error);
      alert('Failed to delete document. Please try again.');
    } finally {
      this.deleting = null;
    }
  }

  getDocumentName(docId: string): string {
    const doc = this.documents.find(d => d.id === docId);
    return doc ? doc.filename : 'Unknown Document';
  }

  getAvailableDocuments(): DocumentData[] {
    if (!this.currentSession) return [];
    
    const associatedIds = this.currentSession.associatedDocuments || [];
    return this.documents.filter(doc => 
      doc.status === 'completed' && 
      !associatedIds.includes(doc.id!)
    );
  }

  async addDocumentToCurrentSession(docId: string) {
    if (!this.currentSession?.id) return;

    try {
      await this.chatService.addDocumentToSession(this.currentSession.id, docId);
      
      // Update local session
      if (!this.currentSession.associatedDocuments) {
        this.currentSession.associatedDocuments = [];
      }
      this.currentSession.associatedDocuments.push(docId);
      
      // Refresh sessions to ensure consistency
      await this.loadUserData();
      
    } catch (error) {
      console.error('Error adding document to session:', error);
      alert('Failed to add document to session. Please try again.');
    }
  }

  async removeDocumentFromCurrentSession(docId: string) {
    if (!this.currentSession?.id) return;

    try {
      await this.chatService.removeDocumentFromSession(this.currentSession.id, docId);
      
      // Update local session
      if (this.currentSession.associatedDocuments) {
        this.currentSession.associatedDocuments = 
          this.currentSession.associatedDocuments.filter(id => id !== docId);
      }
      
      // Refresh sessions to ensure consistency
      await this.loadUserData();
      
    } catch (error) {
      console.error('Error removing document from session:', error);
      alert('Failed to remove document from session. Please try again.');
    }
  }

  getSessionDocuments(): DocumentData[] {
    if (!this.currentSession) return [];
    
    const sessionDocIds = this.currentSession.associatedDocuments || [];
    return this.documents.filter(doc => sessionDocIds.includes(doc.id!));
  }

  isDocumentCompatible(doc: DocumentData): boolean {
    // If document doesn't have embedModel metadata, assume compatible for backward compatibility
    if (!doc.embedModel) return true;
    
    const currentSelection = this.globalModelSelection.getCurrentSelection();
    const currentEmbedModel = currentSelection?.['embed'];
    
    if (!currentEmbedModel) return true;
    
    return doc.embedModel.provider === currentEmbedModel.provider && 
           doc.embedModel.model === currentEmbedModel.model;
  }

  getDocumentById(docId: string): DocumentData | null {
    return this.documents.find(doc => doc.id === docId) || null;
  }

  isDocumentByIdCompatible(docId: string): boolean {
    const doc = this.getDocumentById(docId);
    return doc ? this.isDocumentCompatible(doc) : false;
  }

  async deleteSession(session: ChatSession) {
    if (!session.id || this.deletingSession) {
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete "${session.title}"? This will also delete all associated documents and messages permanently.`);
    if (!confirmed) {
      return;
    }

    this.deletingSession = session.id;

    try {
      await this.chatService.deleteSession(session.id);
      
      // Remove from local sessions list
      this.sessions = this.sessions.filter(s => s.id !== session.id);
      
      // Clear selection if this session was selected
      if (this.currentSession?.id === session.id) {
        this.currentSession = null;
        this.messages = [];
        this.selectedDocument = null;
      }
      
      // Refresh data to ensure consistency
      await this.loadUserData();
      
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Failed to delete session. Please try again.');
    } finally {
      this.deletingSession = null;
    }
  }

  abbreviateTitle(text: string): string {
    const maxLength = 40;
    const cleaned = text.trim().replace(/\s+/g, ' ');
    
    if (cleaned.length <= maxLength) {
      return cleaned;
    }
    
    return cleaned.substring(0, maxLength).trim() + '...';
  }

  async onMcpToggle() {
    console.log('MCP enabled:', this.mcpEnabled);
    
    if (this.mcpEnabled) {
      try {
        // Initialize enabled servers
        const enabledServers = this.mcpRegistry.getEnabledServers();
        console.log('Initializing enabled servers:', enabledServers.map(s => s.name));
        
        for (const server of enabledServers) {
          await this.mcpRegistry.initializeServer(server.id);
        }
        
        // Debug: Check available tools after initialization
        const availableTools = this.mcpRegistry.getAvailableTools();
        console.log('✅ Available tools after MCP init:', availableTools.length, availableTools.map(t => t.name));
        
      } catch (error) {
        console.error('Failed to initialize MCP:', error);
        this.mcpEnabled = false;
        alert('Failed to connect to MCP servers. Please check server availability.');
      }
    }
  }

  async onServerToggle(serverId: string, event: Event) {
    const checkbox = event.target as HTMLInputElement;
    const enabled = checkbox.checked;
    
    try {
      await this.mcpRegistry.toggleServer(serverId, enabled);
      console.log(`Server ${serverId} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Error toggling server:', error);
      // Revert checkbox state on error
      checkbox.checked = !enabled;
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'online': return '✅ Online';
      case 'offline': return '⭕ Offline';
      case 'error': return '❌ Error';
      default: return '⚪ Unknown';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'online': return '✅';
      case 'offline': return '⭕';
      case 'error': return '❌';
      default: return '⚪';
    }
  }

  getToolNames(tools: McpTool[]): string {
    return tools.map(t => t.name).join(', ');
  }

  getTotalEnabledTools(): number {
    return this.availableTools.length;
  }

  getEnabledServersCount(): number {
    return this.mcpServers.filter(s => s.enabled && s.status === 'online').length;
  }

}