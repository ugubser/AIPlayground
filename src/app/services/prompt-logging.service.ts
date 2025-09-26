import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface PromptLogEntry {
  id: string;
  type: 'request' | 'response';
  provider: string;
  model?: string;
  timestamp: Date;
  content: string;
  expanded: boolean;
  sessionContext?:
    | 'rag'
    | 'general'
    | 'vision'
    | 'mcp'
    | 'mcp-tool-call'
    | 'multi-agent-planner'
    | 'multi-agent-verifier'
    | 'multi-agent-critic'
    | string;
  messageId?: string;
  metadata?: Record<string, any>;
  title?: string;
  status?: 'pending' | 'completed' | 'error';
}

@Injectable({
  providedIn: 'root'
})
export class PromptLoggingService {
  private promptLogsSubject = new BehaviorSubject<PromptLogEntry[]>([]);
  public promptLogs$ = this.promptLogsSubject.asObservable();
  
  private isLoggingEnabled = false;

  constructor() {}

  enableLogging(enabled: boolean): void {
    this.isLoggingEnabled = enabled;
    if (!enabled) {
      // Clear logs when disabled
      this.clearLogs();
    }
  }

  isLoggingActive(): boolean {
    return this.isLoggingEnabled;
  }

  addPromptLog(entry: Omit<PromptLogEntry, 'id' | 'expanded'>): string {
    if (!this.isLoggingEnabled) {
      return '';
    }

    const newEntry: PromptLogEntry = {
      ...entry,
      id: this.generateId(),
      expanded: false
    };

    const currentLogs = this.promptLogsSubject.value;
    this.promptLogsSubject.next([...currentLogs, newEntry]);

    return newEntry.id;
  }

  clearLogsForContext(context?: string): void {
    if (!context) {
      this.clearLogs();
      return;
    }
    
    const currentLogs = this.promptLogsSubject.value;
    const filteredLogs = currentLogs.filter(log => log.sessionContext !== context);
    this.promptLogsSubject.next(filteredLogs);
  }

  updatePromptLog(entryId: string, patch: Partial<PromptLogEntry>): void {
    if (!entryId) {
      return;
    }

    const currentLogs = this.promptLogsSubject.value;
    const updatedLogs = currentLogs.map(log => {
      if (log.id !== entryId) {
        return log;
      }

      return {
        ...log,
        ...patch,
        // Preserve original timestamp unless explicitly overridden
        timestamp: patch.timestamp ? patch.timestamp : log.timestamp
      };
    });

    this.promptLogsSubject.next(updatedLogs);
  }

  toggleExpanded(entryId: string): void {
    const currentLogs = this.promptLogsSubject.value;
    const updatedLogs = currentLogs.map(log => 
      log.id === entryId ? { ...log, expanded: !log.expanded } : log
    );
    this.promptLogsSubject.next(updatedLogs);
  }

  clearLogs(): void {
    this.promptLogsSubject.next([]);
  }

  getLogsForSession(sessionContext?: string): PromptLogEntry[] {
    return this.promptLogsSubject.value.filter(log => 
      !sessionContext || log.sessionContext === sessionContext
    );
  }

  getLogsForMessage(messageId: string): PromptLogEntry[] {
    return this.promptLogsSubject.value.filter(log => log.messageId === messageId);
  }

  private generateId(): string {
    return `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Helper method to truncate content for preview
  getTruncatedContent(content: string, maxLines: number = 3): { preview: string; isTruncated: boolean } {
    const lines = content.split('\n');
    if (lines.length <= maxLines) {
      return { preview: content, isTruncated: false };
    }
    
    const preview = lines.slice(0, maxLines).join('\n') + '...';
    return { preview, isTruncated: true };
  }

  updatePromptLogMessageId(entryId: string, messageId: string): void {
    this.updatePromptLog(entryId, { messageId });
  }
}
