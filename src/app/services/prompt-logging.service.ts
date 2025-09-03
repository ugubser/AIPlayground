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
  sessionContext?: 'rag' | 'general' | 'vision' | 'mcp';
  messageId?: string;
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

  addPromptLog(entry: Omit<PromptLogEntry, 'id' | 'expanded'>): void {
    if (!this.isLoggingEnabled) {
      return;
    }

    const newEntry: PromptLogEntry = {
      ...entry,
      id: this.generateId(),
      expanded: false
    };

    const currentLogs = this.promptLogsSubject.value;
    this.promptLogsSubject.next([...currentLogs, newEntry]);
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
}