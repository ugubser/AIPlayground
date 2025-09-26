import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MarkdownModule } from 'ngx-markdown';
import { PromptMessageComponent } from '../prompt-message/prompt-message.component';

import { PdfProcessorService, ChunkData } from '../../services/pdf-processor.service';
import { DocumentService, DocumentData } from '../../services/document.service';
import { ChatService, ChatSession, ChatMessage } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { GlobalModelSelectionService } from '../../services/global-model-selection.service';
import { DynamicModelSelection } from '../../services/models-config.service';
import { McpService } from '../../services/mcp.service';
import { McpRegistryService, McpServerConfig, McpTool } from '../../services/mcp-registry.service';
import { MultiAgentOrchestratorService } from '../../services/multi-agent-orchestrator.service';
import { APP_CONSTANTS } from '../../config/app-constants';
import { ErrorHandlerService } from '../../services/error-handler.service';
import { LoggingService } from '../../services/logging.service';
import { SharedUtilsService } from '../../utils/shared-utils.service';
import { PromptLoggingService, PromptLogEntry } from '../../services/prompt-logging.service';

interface VisionMessage {
  id?: string;
  role: 'user' | 'assistant';
  content?: string;
  image?: { url: string; name: string };
  prompt?: string;
  createdAt: Date;
}

interface GeneralTimelineEntry {
  kind: 'message' | 'prompt';
  timestamp: Date;
  message?: ChatMessage;
  prompt?: PromptLogEntry;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownModule, PromptMessageComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
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
  multiAgentEnabled = false;
  skipCriticPhase = false; // Default to false (include critic phase)
  mcpServers: McpServerConfig[] = [];
  availableTools: McpTool[] = [];

  // UI State
  activeTab: 'rag' | 'chat' | 'vision' = 'rag';
  dragOver = false;
  showAddDocuments = false;

  // Track timeouts for cleanup
  private timeouts: any[] = [];

  // Prompt logging
  promptLogs: PromptLogEntry[] = [];
  generalTimeline: GeneralTimelineEntry[] = [];
  private previousGeneralTimelineLength = 0;

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
    private mcpRegistry: McpRegistryService,
    private multiAgentOrchestrator: MultiAgentOrchestratorService,
    private errorHandler: ErrorHandlerService,
    private logger: LoggingService,
    private utils: SharedUtilsService,
    private promptLogging: PromptLoggingService
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
        this.logger.debug('Auto-scroll failed', fallbackError);
      }
    }
  }

  private scrollToBottomAfterDelay(container: ElementRef, delay: number = APP_CONSTANTS.TIMEOUTS.SCROLL_DELAY) {
    const timeoutId = setTimeout(() => {
      this.scrollToBottom(container);
    }, delay);
    this.timeouts.push(timeoutId);
  }

  ngOnInit() {
    this.loadUserData();
    this.initializeMcpRegistry();
    this.initializePromptLogging();
  }

  private initializePromptLogging() {
    this.promptLogging.promptLogs$.subscribe(logs => {
      this.promptLogs = logs;
      this.updateGeneralTimeline('prompt');
    });
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
      this.logger.error('Error loading user data', error);
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

    if (file.size > APP_CONSTANTS.FILE_SIZE.PDF_MAX_SIZE) {
      alert(`File size must be less than ${APP_CONSTANTS.FILE_SIZE.PDF_MAX_SIZE / (1024 * 1024)}MB.`);
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
        this.logger.info('Document associated with session', { docId, sessionId: this.currentSession.id });
        
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
      const errorMessage = this.errorHandler.handleDocumentError(error, 'process');
      this.uploadProgress = errorMessage;
    } finally {
      this.uploading = false;
      const timeoutId = setTimeout(() => {
        this.uploadProgress = '';
      }, APP_CONSTANTS.TIMEOUTS.UPLOAD_COMPLETE_DISPLAY);
      this.timeouts.push(timeoutId);
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
      this.errorHandler.handleSessionError(error, 'create');
    }
  }

  async selectSession(session: ChatSession) {
    this.currentSession = session;
    try {
      this.messages = await this.chatService.getSessionMessages(session.id!);
      // Scroll to bottom to show latest messages after loading
      if (this.messages.length > 0) {
        this.scrollToBottomAfterDelay(this.ragMessagesContainer, APP_CONSTANTS.TIMEOUTS.SCROLL_DELAY_EXTENDED);
      }
    } catch (error) {
      this.logger.error('Error loading session messages', { sessionId: session.id, error });
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
      const errorContent = this.errorHandler.createChatErrorMessage(error, 'RAG');
      
      // Add error message
      this.messages.push({
        role: 'assistant',
        content: errorContent,
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
    this.updateGeneralTimeline('message');
    
    // Scroll to show the user message
    this.scrollToBottomAfterDelay(this.generalMessagesContainer);

    try {
      if (this.mcpEnabled && this.multiAgentEnabled) {
        // Use Multi-Agent orchestration with MCP tools
        await this.sendMultiAgentMessage(messageText);
      } else if (this.mcpEnabled) {
        // Use MCP-enabled chat with tool calling capability - handle responses separately
        await this.sendMcpMessageWithSeparateResponses(messageText);
      } else {
        // Use regular general chat
        const response = await this.chatService.sendGeneralMessage(
          messageText,
          this.globalModelSelection.getSelectionForRequest()
        );
        this.generalMessages.push(response);
        this.updateGeneralTimeline('message');
      }
      
      // Scroll to show the assistant response
      this.scrollToBottomAfterDelay(this.generalMessagesContainer);
      
    } catch (error) {
      const errorContent = this.errorHandler.createChatErrorMessage(error, 'General');
      
      this.generalMessages.push({
        role: 'assistant',
        content: errorContent,
        createdAt: new Date()
      });
      this.updateGeneralTimeline('message');
      
      // Scroll to show the error message
      this.scrollToBottomAfterDelay(this.generalMessagesContainer);
    } finally {
      this.sendingGeneral = false;
    }
  }

  private async sendMcpMessage(message: string): Promise<ChatMessage> {
    try {
      // Generate a consistent message ID for the entire MCP conversation
      const conversationMessageId = `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      
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
        this.logger.debug('Using MCP provider for tool calling', mcpModelSelection);
      }
      
      // Step 1: Send message to LLM with available tools
      const mcpResponse = await this.chatService.sendMcpMessage(
        message,
        mcpModelSelection,
        undefined,
        conversationMessageId
      );
      
      // Step 2: If LLM requested tool calls, execute them and get final response
      if (mcpResponse.toolCalls && mcpResponse.toolCalls.length > 0) {
        this.logger.debug('LLM requested tool calls', mcpResponse.toolCalls);
        
        const toolResults: any[] = [];
        
        for (const toolCall of mcpResponse.toolCalls) {
          try {
            this.logger.debug('Executing tool call', toolCall);
            const result = await this.mcpService.callTool(toolCall, conversationMessageId);
            const toolOutput = result.content.map(c => c.text).join(' ');
            
            toolResults.push({
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              result: toolOutput
            });
          } catch (toolError) {
            this.logger.error('Tool call error', toolError);
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
          toolResults,
          conversationMessageId
        );
        
        return {
          id: conversationMessageId,
          role: 'assistant',
          content: finalResponse.answer,
          createdAt: new Date()
        };
      }
      
      // No tool calls, return LLM response directly
      return {
        id: conversationMessageId,
        role: 'assistant',
        content: mcpResponse.answer,
        createdAt: new Date()
      };
      
    } catch (error) {
      const errorContent = this.errorHandler.createChatErrorMessage(error, 'MCP');
      
      return {
        role: 'assistant',
        content: errorContent,
        createdAt: new Date()
      };
    }
  }

  private async sendMcpMessageWithSeparateResponses(message: string): Promise<void> {
    try {
      // Generate a consistent message ID for the entire MCP conversation
      const conversationMessageId = `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      
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
        this.logger.debug('Using MCP provider for tool calling', mcpModelSelection);
      }
      
      // Step 1: Send message to LLM with available tools
      const firstMessageId = conversationMessageId + '_reasoning';
      const mcpResponse = await this.chatService.sendMcpMessage(
        message,
        mcpModelSelection,
        undefined,
        firstMessageId
      );
      
      // Step 2: Show first response immediately if there are tool calls
      if (mcpResponse.toolCalls && mcpResponse.toolCalls.length > 0) {
        this.logger.debug('LLM requested tool calls', mcpResponse.toolCalls);
        
        // Show the first response (reasoning) immediately
        if (mcpResponse.answer && mcpResponse.answer.trim() && mcpResponse.answer !== 'I need to use some tools to answer your question.') {
          this.generalMessages.push({
            id: firstMessageId,
            role: 'assistant',
            content: this.formatThinkingContent(mcpResponse.answer),
            createdAt: new Date()
          });
          this.updateGeneralTimeline('message');
          
          // Scroll to show the first response
          this.scrollToBottomAfterDelay(this.generalMessagesContainer);
        }
        
        const toolResults: any[] = [];
        
        for (const toolCall of mcpResponse.toolCalls) {
          try {
            this.logger.debug('Executing tool call', toolCall);
            const result = await this.mcpService.callTool(toolCall, conversationMessageId);
            const toolOutput = result.content.map(c => c.text).join(' ');
            
            toolResults.push({
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              result: toolOutput
            });
          } catch (toolError) {
            this.logger.error('Tool call error', toolError);
            toolResults.push({
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              result: `Error: ${toolError}`
            });
          }
        }
        
        // Step 3: Send tool results back to LLM for final contextual response
        const finalMessageId = conversationMessageId + '_final';
        const finalResponse = await this.chatService.sendMcpMessage(
          message,
          mcpModelSelection,
          toolResults,
          finalMessageId
        );
        
        // Show the final response
        this.generalMessages.push({
          id: finalMessageId,
          role: 'assistant',
          content: this.formatAnswerContent(finalResponse.answer),
          createdAt: new Date()
        });
        this.updateGeneralTimeline('message');

        // Update MCP prompt logs to use the final message ID
        this.updateMcpPromptLogs(finalMessageId);

        // Scroll to show the final response
        this.scrollToBottomAfterDelay(this.generalMessagesContainer);
        
      } else {
        // No tool calls, show response directly
        this.generalMessages.push({
          id: conversationMessageId,
          role: 'assistant',
          content: mcpResponse.answer,
          createdAt: new Date()
        });
        this.updateGeneralTimeline('message');

        // Update MCP prompt logs to use the conversation message ID
        this.updateMcpPromptLogs(conversationMessageId);

        // Scroll to show the response
        this.scrollToBottomAfterDelay(this.generalMessagesContainer);
      }
      
    } catch (error) {
      const errorContent = this.errorHandler.createChatErrorMessage(error, 'MCP');
      
      this.generalMessages.push({
        role: 'assistant',
        content: errorContent,
        createdAt: new Date()
      });
      this.updateGeneralTimeline('message');
      
      // Scroll to show the error message
      this.scrollToBottomAfterDelay(this.generalMessagesContainer);
    }
  }

  private async sendMultiAgentMessage(message: string): Promise<void> {
    this.sendingGeneral = true;
    
    try {
      // Check if multi-agent orchestration is available
      if (!this.multiAgentOrchestrator.isAvailable()) {
        throw new Error('Multi-agent orchestration requires MCP tools to be available');
      }

      // Show a "thinking" message immediately
      const thinkingMessage: ChatMessage = {
        role: 'assistant',
        content: '🤔 **Multi-Agent Processing**\n\nAnalyzing your request and planning execution...',
        createdAt: new Date()
      };
      this.generalMessages.push(thinkingMessage);
      this.updateGeneralTimeline('message');
      this.scrollToBottomAfterDelay(this.generalMessagesContainer);

      // Get current model selection (same logic as MCP flow)
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
        this.logger.debug('Using MCP provider for multi-agent orchestration', mcpModelSelection);
      }

      // Get temperature and seed parameters (same logic as MCP flow)
      const modelParams = this.globalModelSelection.getModelParamsForRequest();
      
      // Create orchestration request with all parameters
      const orchestrationRequest = {
        query: message,
        modelSelection: mcpModelSelection,
        temperature: modelParams.temperature,
        seed: modelParams.seed !== -1 ? modelParams.seed : undefined,
        enablePromptLogging: this.promptLogging.isLoggingActive(),
        skipCriticPhase: this.skipCriticPhase
      };

      this.logger.debug('Multi-agent orchestration request parameters:', {
        temperature: orchestrationRequest.temperature,
        seed: orchestrationRequest.seed,
        enablePromptLogging: orchestrationRequest.enablePromptLogging,
        model: mcpModelSelection?.['llm']
      });

      // Process with multi-agent orchestration
      const orchestrationResponse = await this.multiAgentOrchestrator.processQueryWithParams(orchestrationRequest);

      if (orchestrationResponse.success) {
        // Generate a unique message ID for this multi-agent response
        const messageId = `multiagent_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        
        // Replace the thinking message with the final answer (with ID)
        const lastMessageIndex = this.generalMessages.length - 1;
        this.generalMessages[lastMessageIndex] = {
          id: messageId,
          role: 'assistant',
          content: orchestrationResponse.finalAnswer,
          createdAt: new Date()
        };
        this.updateGeneralTimeline('message');

        // Update all multi-agent prompt logs to use this message ID
        this.updateMultiAgentPromptLogs(messageId);

        // Add execution log to prompt logs if available for debugging
        if (orchestrationResponse.executionLog.length > 0) {
          console.log('Multi-Agent Orchestration Log:', {
            query: message,
            tasks: orchestrationResponse.tasks,
            executionLog: orchestrationResponse.executionLog,
            finalAnswer: orchestrationResponse.finalAnswer
          });
        }

      } else {
        // Show error message
        const errorMessage = orchestrationResponse.finalAnswer || 'Multi-agent orchestration failed';
        const lastMessageIndex = this.generalMessages.length - 1;
        this.generalMessages[lastMessageIndex] = {
          role: 'assistant',
          content: `❌ **Multi-Agent Error**\n\n${errorMessage}`,
          createdAt: new Date()
        };
        this.updateGeneralTimeline('message');
      }

      this.scrollToBottomAfterDelay(this.generalMessagesContainer);

    } catch (error) {
      // Replace thinking message with error
      const errorContent = this.errorHandler.createChatErrorMessage(error, 'General');
      const lastMessageIndex = this.generalMessages.length - 1;
      
      this.generalMessages[lastMessageIndex] = {
        role: 'assistant',
        content: `❌ **Multi-Agent Error**\n\n${errorContent}`,
        createdAt: new Date()
      };
      this.updateGeneralTimeline('message');
      
      this.scrollToBottomAfterDelay(this.generalMessagesContainer);
    } finally {
      this.sendingGeneral = false;
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
    if (!file.type.startsWith(APP_CONSTANTS.FILE_TYPES.IMAGE_PREFIX)) {
      alert('Please select an image file.');
      return;
    }

    if (file.size > APP_CONSTANTS.FILE_SIZE.IMAGE_MAX_SIZE) {
      alert(`Image size must be less than ${APP_CONSTANTS.FILE_SIZE.IMAGE_MAX_SIZE / (1024 * 1024)}MB.`);
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
        id: response.id,
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
      const errorContent = this.errorHandler.createChatErrorMessage(error, 'Vision');
      
      // Add error message
      this.visionMessages.push({
        role: 'assistant',
        content: errorContent,
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
      const errorMessage = this.errorHandler.handleDocumentError(error, 'delete');
      alert(errorMessage);
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
      this.logger.error('Error adding document to session', { sessionId: this.currentSession.id, docId, error });
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
      this.logger.error('Error removing document from session', { sessionId: this.currentSession.id, docId, error });
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
      const errorMessage = this.errorHandler.handleSessionError(error, 'delete');
      alert(errorMessage);
    } finally {
      this.deletingSession = null;
    }
  }

  abbreviateTitle(text: string): string {
    return this.utils.abbreviateText(text, APP_CONSTANTS.UI.MAX_TITLE_LENGTH);
  }

  async onMcpToggle() {
    this.logger.info('MCP toggled', { enabled: this.mcpEnabled });
    
    // Update global model selection service with MCP state
    this.globalModelSelection.updateMcpEnabled(this.mcpEnabled);
    
    // If MCP is disabled, also disable multi-agent
    if (!this.mcpEnabled) {
      this.multiAgentEnabled = false;
    }
    
    if (this.mcpEnabled) {
      try {
        // Initialize enabled servers
        const enabledServers = this.mcpRegistry.getEnabledServers();
        this.logger.info('Initializing MCP servers', { serverNames: enabledServers.map(s => s.name) });
        
        for (const server of enabledServers) {
          await this.mcpRegistry.initializeServer(server.id);
        }
        
        // Debug: Check available tools after initialization
        const availableTools = this.mcpRegistry.getAvailableTools();
        this.logger.info('MCP initialization complete', { 
          toolCount: availableTools.length, 
          toolNames: availableTools.map(t => t.name) 
        });
        
      } catch (error) {
        this.logger.error('Failed to initialize MCP', error);
        this.mcpEnabled = false;
        // Update global service with the reverted state
        this.globalModelSelection.updateMcpEnabled(false);
        alert('Failed to connect to MCP servers. Please check server availability.');
      }
    }
  }

  onMultiAgentToggle() {
    this.logger.info('Multi-Agent toggled', { enabled: this.multiAgentEnabled });
    
    // If multi-agent is disabled, no additional cleanup needed
    // The orchestration will be handled at message send time
  }

  async onServerToggle(serverId: string, event: Event) {
    const checkbox = event.target as HTMLInputElement;
    const enabled = checkbox.checked;
    
    try {
      await this.mcpRegistry.toggleServer(serverId, enabled);
      this.logger.info('MCP server toggled', { serverId, enabled });
    } catch (error) {
      this.logger.error('Error toggling MCP server', { serverId, enabled, error });
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

  getPromptLogsForContext(context: 'rag' | 'general' | 'vision' | 'mcp'): PromptLogEntry[] {
    return this.promptLogs.filter(log => log.sessionContext === context);
  }

  getPromptLogsForMessage(messageId: string): PromptLogEntry[] {
    // Now that we use specific message IDs for each interaction, return exact matches
    return this.promptLogs.filter(log => log.messageId === messageId);
  }

  trackByPromptId(index: number, item: PromptLogEntry): string {
    return item.id;
  }

  /**
   * Formats content to ensure proper markdown rendering by adding a newline
   * before markdown content when it starts with markdown syntax
   */
  private formatAnswerContent(answer: string): string {
    return this.formatPrefixedContent('✅ **Answer:**', answer);
  }

  /**
   * Formats content to ensure proper markdown rendering by adding a newline
   * before markdown content when it starts with markdown syntax
   */
  private formatThinkingContent(answer: string): string {
    return this.formatPrefixedContent('🤔 **Thinking:**', answer);
  }

  /**
   * Generic formatter for prefixed content with markdown detection
   */
  private formatPrefixedContent(prefix: string, content: string): string {
    // Common markdown patterns that should start on a new line
    const markdownPatterns = [
      /^#{1,6}\s/, // Headers (# ## ### etc.)
      /^-\s/, // Unordered lists
      /^\*\s/, // Unordered lists (asterisk)
      /^\+\s/, // Unordered lists (plus)
      /^\d+\.\s/, // Ordered lists
      /^>\s/, // Blockquotes
      /^```/, // Code blocks
      /^`/, // Inline code at start
      /^\|.*\|/, // Tables
      /^---/, // Horizontal rules
      /^\*\*/, // Bold at start
      /^_/, // Italic/underscore at start
    ];

    const startsWithMarkdown = markdownPatterns.some(pattern => pattern.test(content.trim()));
    
    if (startsWithMarkdown) {
      return `${prefix}\n\n${content}`;
    } else {
      return `${prefix} ${content}`;
    }
  }

  /**
   * Updates all recent multi-agent prompt logs to use the specified message ID
   * This connects the multi-agent prompts to the final assistant message for display
   */
  private updateMultiAgentPromptLogs(messageId: string): void {
    // Get recent multi-agent and MCP prompt logs (last 2 minutes to be safe)
    const cutoffTime = new Date(Date.now() - 2 * 60 * 1000);
    const recentLogs = this.promptLogs.filter(log =>
      log.timestamp > cutoffTime &&
      (log.sessionContext?.startsWith('multi-agent') || log.sessionContext === 'mcp-tool-call')
    );

    // Update their message IDs to connect them to this assistant message
    recentLogs.forEach(log => {
      // Update the log entry in the prompt logging service
      this.promptLogging.updatePromptLogMessageId(log.id, messageId);
    });

    console.log(`Updated ${recentLogs.length} multi-agent and MCP prompt logs with message ID: ${messageId}`);
  }

  private updateGeneralTimeline(trigger: 'message' | 'prompt' = 'message'): void {
    const relevantPrompts = this.promptLogs.filter(log => this.isGeneralPromptLog(log));

    const combined: GeneralTimelineEntry[] = [
      ...this.generalMessages.map(message => ({
        kind: 'message' as const,
        timestamp: message.createdAt,
        message
      })),
      ...relevantPrompts.map(prompt => ({
        kind: 'prompt' as const,
        timestamp: prompt.timestamp,
        prompt
      }))
    ];

    combined.sort((a, b) => {
      const timeDiff = a.timestamp.getTime() - b.timestamp.getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }

      const seqA = this.getTimelineSequence(a);
      const seqB = this.getTimelineSequence(b);
      if (seqA !== seqB) {
        return seqA - seqB;
      }

      if (a.kind === 'prompt' && b.kind === 'prompt' && a.prompt && b.prompt) {
        return a.prompt.id.localeCompare(b.prompt.id);
      }

      return 0;
    });

    const lengthIncreased = combined.length > this.previousGeneralTimelineLength;
    this.generalTimeline = combined;
    this.previousGeneralTimelineLength = combined.length;

    if (
      trigger === 'prompt' &&
      lengthIncreased &&
      this.activeTab === 'chat' &&
      this.generalMessagesContainer
    ) {
      this.scrollToBottomAfterDelay(this.generalMessagesContainer);
    }
  }

  private isGeneralPromptLog(log: PromptLogEntry): boolean {
    const context = log.sessionContext || '';
    if (context === 'general' || context === 'mcp' || context === 'mcp-tool-call') {
      return true;
    }
    return context.startsWith('multi-agent');
  }

  private getTimelineSequence(entry: GeneralTimelineEntry): number {
    if (entry.kind === 'prompt') {
      const sequenceValue = entry.prompt?.metadata?.['sequence'];
      return typeof sequenceValue === 'number' ? sequenceValue : 500;
    }
    // Regular chat messages should appear first when timestamps match
    return 0;
  }

  trackTimelineEntry(index: number, entry: GeneralTimelineEntry): string {
    if (entry.kind === 'prompt') {
      return entry.prompt?.id || `prompt_${index}`;
    }
    const message = entry.message;
    if (message?.id) {
      return message.id;
    }
    return message ? `message_${message.createdAt.getTime()}_${index}` : `message_${index}`;
  }

  /**
   * Updates recent MCP prompt logs to use the specified message ID
   * This connects the MCP prompts to the assistant message for display
   */
  private updateMcpPromptLogs(messageId: string): void {
    // Get recent MCP prompt logs (last 30 seconds to be precise)
    const cutoffTime = new Date(Date.now() - 30 * 1000);
    const recentMcpLogs = this.promptLogs.filter(log =>
      log.timestamp > cutoffTime &&
      log.sessionContext === 'mcp-tool-call'
    );

    // Update their message IDs to connect them to this assistant message
    recentMcpLogs.forEach(log => {
      // Update the log entry in the prompt logging service
      this.promptLogging.updatePromptLogMessageId(log.id, messageId);
    });

    console.log(`Updated ${recentMcpLogs.length} MCP prompt logs with message ID: ${messageId}`);
  }

  ngOnDestroy() {
    // Clean up all pending timeouts to prevent memory leaks
    this.timeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    this.timeouts = [];
  }

}
