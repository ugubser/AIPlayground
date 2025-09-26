import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PromptLogEntry, PromptLoggingService } from '../../services/prompt-logging.service';

@Component({
  selector: 'app-prompt-message',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="prompt-message"
         [class.request]="entry.type === 'request' && !isMcpQuery && !isMcpResponse && !isFollowUp"
         [class.response]="entry.type === 'response' && !isMcpQuery && !isMcpResponse && !isFollowUp"
         [class.search-results]="isSearchResults"
         [class.mcp-query]="isMcpQuery"
         [class.mcp-response]="isMcpResponse"
         [class.followup-request]="isFollowUp && entry.type === 'request'"
         [class.followup-response]="isFollowUp && entry.type === 'response'">
      <div class="prompt-header">
        <span class="prompt-label">
          {{ entry.type === 'request' ? '📤' : '📥' }}
          {{ isFollowUp ? '🔄 Follow-up ' : '' }}{{ entry.type | titlecase }} - {{ entry.provider }}{{ entry.model ? '/' + entry.model : '' }}
        </span>
        <span class="prompt-timestamp">{{ entry.timestamp.toLocaleTimeString() }}</span>
      </div>

      <div class="prompt-content" (click)="toggleExpanded()">
        <pre class="prompt-text" [class.expanded]="entry.expanded">{{ displayContent }}</pre>
        <div class="prompt-expand-hint" *ngIf="isTruncated && !entry.expanded">
          Click to expand...
        </div>
      </div>
    </div>
  `,
  styles: [`
    .prompt-message {
      margin: 8px 0;
      border: 1px solid #dc3545;
      border-radius: 6px;
      background-color: rgba(220, 53, 69, 0.05);
      font-size: 0.85em;
      cursor: pointer;
    }

    .prompt-message.request {
      border-color: #fd7e14;
      background-color: rgba(253, 126, 20, 0.05);
    }

    .prompt-message.response {
      border-color: #dc3545;
      background-color: rgba(220, 53, 69, 0.05);
    }

    .prompt-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 12px;
      background-color: rgba(0, 0, 0, 0.02);
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      font-size: 0.9em;
    }

    .prompt-label {
      font-weight: 600;
      color: #dc3545;
    }

    .request .prompt-label {
      color: #fd7e14;
    }

    .prompt-timestamp {
      color: #6c757d;
      font-size: 0.8em;
    }

    .prompt-content {
      padding: 8px 12px;
    }

    .prompt-text {
      margin: 0;
      white-space: pre-wrap;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 0.8em;
      color: #dc3545;
      background: none;
      border: none;
      max-height: 60px;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .request .prompt-text {
      color: #fd7e14;
    }

    .prompt-text.expanded {
      max-height: none;
      overflow: visible;
    }

    .prompt-expand-hint {
      color: #6c757d;
      font-size: 0.75em;
      text-align: center;
      margin-top: 4px;
      font-style: italic;
    }

    .prompt-message:hover {
      background-color: rgba(220, 53, 69, 0.08);
    }

    .prompt-message.request:hover {
      background-color: rgba(253, 126, 20, 0.08);
    }

    .prompt-message.search-results {
      border-color: #17a2b8;
      background-color: rgba(23, 162, 184, 0.05);
    }

    .search-results .prompt-label {
      color: #17a2b8;
    }

    .search-results .prompt-text {
      color: #17a2b8;
    }

    .prompt-message.search-results:hover {
      background-color: rgba(23, 162, 184, 0.08);
    }

    .prompt-message.mcp-query {
      border-color: #28a745 !important;
      background-color: rgba(40, 167, 69, 0.05) !important;
    }

    .prompt-message.mcp-query .prompt-label {
      color: #28a745 !important;
    }

    .prompt-message.mcp-query .prompt-text {
      color: #28a745 !important;
    }

    .prompt-message.mcp-query:hover {
      background-color: rgba(40, 167, 69, 0.08) !important;
    }

    .prompt-message.mcp-response {
      border-color: #17a2b8 !important;
      background-color: rgba(23, 162, 184, 0.05) !important;
    }

    .prompt-message.mcp-response .prompt-label {
      color: #17a2b8 !important;
    }

    .prompt-message.mcp-response .prompt-text {
      color: #17a2b8 !important;
    }

    .prompt-message.mcp-response:hover {
      background-color: rgba(23, 162, 184, 0.08) !important;
    }

    .prompt-message.followup-request {
      border-color: #6f42c1 !important;
      background-color: rgba(111, 66, 193, 0.05) !important;
    }

    .prompt-message.followup-request .prompt-label {
      color: #6f42c1 !important;
    }

    .prompt-message.followup-request .prompt-text {
      color: #6f42c1 !important;
    }

    .prompt-message.followup-request:hover {
      background-color: rgba(111, 66, 193, 0.08) !important;
    }

    .prompt-message.followup-response {
      border-color: #e83e8c !important;
      background-color: rgba(232, 62, 140, 0.05) !important;
    }

    .prompt-message.followup-response .prompt-label {
      color: #e83e8c !important;
    }

    .prompt-message.followup-response .prompt-text {
      color: #e83e8c !important;
    }

    .prompt-message.followup-response:hover {
      background-color: rgba(232, 62, 140, 0.08) !important;
    }
  `]
})
export class PromptMessageComponent {
  @Input() entry!: PromptLogEntry;

  constructor(private promptLogging: PromptLoggingService) {}

  get displayContent(): string {
    if (this.entry.expanded) {
      return this.entry.content;
    }
    const truncated = this.promptLogging.getTruncatedContent(this.entry.content, 3);
    return truncated.preview;
  }

  get isTruncated(): boolean {
    return this.promptLogging.getTruncatedContent(this.entry.content, 3).isTruncated;
  }

  get isSearchResults(): boolean {
    return this.entry.provider === 'RAG Search' && this.entry.model === 'Document Search';
  }

  get isMcpQuery(): boolean {
    return this.entry.sessionContext === 'mcp-tool-call' && this.entry.type === 'request';
  }

  get isMcpResponse(): boolean {
    return this.entry.sessionContext === 'mcp-tool-call' && this.entry.type === 'response';
  }

  get isFollowUp(): boolean {
    return this.entry.sessionContext?.startsWith('multi-agent-followup-') || false;
  }

  toggleExpanded(): void {
    this.promptLogging.toggleExpanded(this.entry.id);
  }
}