import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PromptLogEntry, PromptLoggingService } from '../../services/prompt-logging.service';

@Component({
  selector: 'app-prompt-message',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="prompt-message"
         [class.request]="entry.type === 'request' && !isMcpQuery && !isMcpResponse && !isFollowUp && !isLocalOperation"
         [class.response]="entry.type === 'response' && !isMcpQuery && !isMcpResponse && !isFollowUp && !isLocalOperation"
         [class.search-results]="isSearchResults"
         [class.mcp-query]="isMcpQuery || isLocalRequest"
         [class.mcp-response]="isMcpResponse || isLocalResponse"
         [class.followup-request]="isFollowUp && entry.type === 'request'"
         [class.followup-response]="isFollowUp && entry.type === 'response'">
      <div class="prompt-header">
        <div class="prompt-header-top">
          <span class="prompt-title">{{ displayTitle }}</span>
          <span
            class="prompt-status"
            *ngIf="entry.status"
            [class.pending]="entry.status === 'pending'"
            [class.completed]="entry.status === 'completed'"
            [class.error]="entry.status === 'error'"
          >
            {{ entry.status | titlecase }}
          </span>
        </div>
        <div class="prompt-meta">
          <span class="prompt-label">
            {{ entry.type === 'request' ? '📤' : '📥' }}
            {{ isFollowUp ? '🔄 Follow-up ' : '' }}{{ entry.type | titlecase }} · {{ entry.provider }}{{ entry.model ? '/' + entry.model : '' }}
          </span>
          <span class="prompt-timestamp">{{ entry.timestamp.toLocaleTimeString() }}</span>
        </div>
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
      background-color: rgba(220, 53, 69, 0.08);
      font-size: 0.85em;
      cursor: pointer;
    }

    .prompt-message.request {
      border-color: #fd7e14;
      background-color: rgba(253, 126, 20, 0.1);
    }

    .prompt-message.response {
      border-color: #dc3545;
      background-color: rgba(220, 53, 69, 0.1);
    }

    .prompt-header {
      padding: 8px 12px 6px 12px;
      background-color: rgba(0, 0, 0, 0.35);
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      font-size: 0.9em;
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: #ffffff;
    }

    .prompt-header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .prompt-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .prompt-title {
      font-weight: 600;
      color: #ffffff;
    }

    .prompt-label {
      font-weight: 500;
      color: #ffffff;
    }

    .prompt-timestamp {
      color: rgba(255, 255, 255, 0.85);
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
      background-color: rgba(40, 167, 69, 0.1) !important;
    }

    .prompt-message.mcp-query .prompt-label {
      color: #ffffff !important;
    }

    .prompt-message.mcp-query .prompt-text {
      color: #28a745 !important;
    }

    .prompt-message.mcp-query:hover {
      background-color: rgba(40, 167, 69, 0.08) !important;
    }

    .prompt-message.mcp-response {
      border-color: #17a2b8 !important;
      background-color: rgba(23, 162, 184, 0.1) !important;
    }

    .prompt-message.mcp-response .prompt-label {
      color: #ffffff !important;
    }

    .prompt-message.mcp-response .prompt-text {
      color: #17a2b8 !important;
    }

    .prompt-message.mcp-response:hover {
      background-color: rgba(23, 162, 184, 0.08) !important;
    }

    .prompt-message.followup-request {
      border-color: #6f42c1 !important;
      background-color: rgba(111, 66, 193, 0.1) !important;
    }

    .prompt-message.followup-request .prompt-label {
      color: #ffffff !important;
    }

    .prompt-message.followup-request .prompt-text {
      color: #6f42c1 !important;
    }

    .prompt-message.followup-request:hover {
      background-color: rgba(111, 66, 193, 0.08) !important;
    }

    .prompt-message.followup-response {
      border-color: #e83e8c !important;
      background-color: rgba(232, 62, 140, 0.1) !important;
    }

    .prompt-message.followup-response .prompt-label {
      color: #ffffff !important;
    }

    .prompt-message.followup-response .prompt-text {
      color: #e83e8c !important;
    }

    .prompt-message.followup-response:hover {
      background-color: rgba(232, 62, 140, 0.08) !important;
    }

    .prompt-status {
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 0.75em;
      font-weight: 600;
      text-transform: uppercase;
      background-color: rgba(108, 117, 125, 0.1);
      color: #6c757d;
    }

    .prompt-status.pending {
      background-color: rgba(253, 126, 20, 0.15);
      color: #fd7e14;
    }

    .prompt-status.completed {
      background-color: rgba(40, 167, 69, 0.15);
      color: #28a745;
    }

    .prompt-status.error {
      background-color: rgba(220, 53, 69, 0.15);
      color: #dc3545;
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

  get isLocalOperation(): boolean {
    const provider = this.entry.provider;
    if (!provider) {
      return false;
    }
    const localProviders = [
      'Multi-Agent Planner',
      'Task Executor',
      'Multi-task Executor',
      'Result Verifier',
      'Response Critic',
      'Multi-Agent Orchestrator',
    ];
    return localProviders.some(name => provider.includes(name));
  }

  get isLocalRequest(): boolean {
    return this.isLocalOperation && this.entry.type === 'request';
  }

  get isLocalResponse(): boolean {
    return this.isLocalOperation && this.entry.type === 'response';
  }

  get displayTitle(): string {
    if (this.entry.title) {
      return this.entry.title;
    }

    if (this.entry.metadata && typeof this.entry.metadata['title'] === 'string') {
      return this.entry.metadata['title'];
    }

    if (this.isFollowUp) {
      return this.entry.type === 'request' ? 'Follow-up Request' : 'Follow-up Response';
    }

    const typeLabel = this.entry.type === 'request' ? 'Request' : 'Response';
    return `${typeLabel} · ${this.entry.provider}`;
  }

  toggleExpanded(): void {
    this.promptLogging.toggleExpanded(this.entry.id);
  }
}
