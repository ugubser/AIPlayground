import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModelsConfigService, RAGModelSelection } from '../../services/models-config.service';

@Component({
  selector: 'app-model-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="model-selector">
      <div class="compact-row">
        <div class="model-group-compact">
          <label>LLM:</label>
          <select [(ngModel)]="selection.llm.provider" (ngModelChange)="onLLMProviderChange()">
            <option *ngFor="let provider of llmProviders" [value]="provider">
              {{provider}}
            </option>
          </select>
          <select [(ngModel)]="selection.llm.model" (ngModelChange)="onSelectionChange()">
            <option *ngFor="let model of availableLLMModels" [value]="model">
              {{getShortModelName(model)}}
            </option>
          </select>
        </div>
        <div class="model-group-compact">
          <label>Embed:</label>
          <select [(ngModel)]="selection.embed.provider" (ngModelChange)="onEmbedProviderChange()">
            <option *ngFor="let provider of embedProviders" [value]="provider">
              {{provider}}
            </option>
          </select>
          <select [(ngModel)]="selection.embed.model" (ngModelChange)="onSelectionChange()">
            <option *ngFor="let model of availableEmbedModels" [value]="model">
              {{getShortModelName(model)}}
            </option>
          </select>
        </div>
        <button class="reset-btn-compact" (click)="resetToDefaults()" title="Reset to Defaults">⟲</button>
      </div>
    </div>
  `,
  styles: [`
    .model-selector {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--space-4) var(--space-5);
      box-shadow: var(--shadow-sm);
      backdrop-filter: blur(10px);
      transition: all var(--transition-fast);
    }

    .model-selector:hover {
      border-color: var(--color-primary);
      box-shadow: var(--shadow-md);
    }

    .compact-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
    }

    .model-group-compact {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      flex: 1;
      min-width: 180px;
    }

    .model-group-compact label {
      font-size: 0.6875rem;
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      min-width: 35px;
      flex-shrink: 0;
    }

    select {
      flex: 1;
      padding: var(--space-1) var(--space-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: 0.75rem;
      font-family: var(--font-family-primary);
      background: var(--color-surface-elevated);
      color: var(--color-text-primary);
      min-width: 100px;
      transition: all var(--transition-fast);
      appearance: none;
      background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23b3b3b3' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e");
      background-position: right var(--space-1) center;
      background-repeat: no-repeat;
      background-size: 0.875rem;
      padding-right: var(--space-6);
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    select option {
      background: var(--color-surface-elevated);
      color: var(--color-text-primary);
      padding: var(--space-2);
      border: none;
    }
    
    /* Ensure dropdown options have proper contrast in all browsers */
    select option:checked {
      background: var(--color-primary);
      color: var(--color-white);
    }
    
    select option:hover {
      background: var(--color-surface-hover);
      color: var(--color-text-primary);
    }

    select:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px rgba(0, 102, 204, 0.3);
      background: var(--color-surface-elevated);
    }

    select:hover {
      border-color: var(--color-primary);
      background: var(--color-surface-elevated);
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
    }

    .reset-btn-compact {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      color: var(--color-text-secondary);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
      transition: all var(--transition-fast);
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .reset-btn-compact:hover {
      background: var(--color-surface-hover);
      border-color: var(--color-primary);
      color: var(--color-primary);
      transform: rotate(180deg);
    }

    .reset-btn-compact:focus {
      outline: none;
      box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.2);
    }

    /* Two-row layout for better spacing when needed */
    @media (max-width: 900px) {
      .compact-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        gap: var(--space-3);
        align-items: stretch;
      }

      .model-group-compact:nth-child(1) {
        grid-column: 1 / 2;
        grid-row: 1 / 2;
      }

      .model-group-compact:nth-child(2) {
        grid-column: 2 / 3;
        grid-row: 1 / 2;
      }

      .reset-btn-compact {
        grid-column: 1 / 3;
        grid-row: 2 / 3;
        justify-self: center;
        width: auto;
        padding: var(--space-2) var(--space-4);
      }
    }

    @media (max-width: 768px) {
      .model-selector {
        padding: var(--space-3) var(--space-4);
      }

      .compact-row {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--space-3);
      }

      .model-group-compact {
        min-width: auto;
      }

      .model-group-compact label {
        min-width: 50px;
      }

      select {
        min-width: auto;
      }

      .reset-btn-compact {
        align-self: center;
        width: 32px;
        padding: var(--space-2) var(--space-3);
      }
    }
  `]
})
export class ModelSelectorComponent implements OnInit {
  @Input() appName: string = 'rag';
  @Input() showCurrentSelection: boolean = true;
  @Output() selectionChange = new EventEmitter<RAGModelSelection>();

  selection: RAGModelSelection = {
    llm: { provider: '', model: '' },
    embed: { provider: '', model: '' }
  };

  llmProviders: string[] = [];
  embedProviders: string[] = [];
  availableLLMModels: string[] = [];
  availableEmbedModels: string[] = [];

  constructor(private modelsConfig: ModelsConfigService) {}

  ngOnInit() {
    this.initializeProviders();
    this.resetToDefaults();
  }

  private initializeProviders() {
    this.llmProviders = this.modelsConfig.getProviders(this.appName, 'LLM');
    this.embedProviders = this.modelsConfig.getProviders(this.appName, 'EMBED');
  }

  resetToDefaults() {
    const defaultSelection = this.modelsConfig.getDefaultSelection(this.appName);
    if (defaultSelection) {
      this.selection = { ...defaultSelection };
      this.updateAvailableModels();
      this.onSelectionChange();
    }
  }

  onLLMProviderChange() {
    this.availableLLMModels = this.modelsConfig.getModels(this.appName, 'LLM', this.selection.llm.provider);
    this.selection.llm.model = this.availableLLMModels[0] || '';
    this.onSelectionChange();
  }

  onEmbedProviderChange() {
    this.availableEmbedModels = this.modelsConfig.getModels(this.appName, 'EMBED', this.selection.embed.provider);
    this.selection.embed.model = this.availableEmbedModels[0] || '';
    this.onSelectionChange();
  }

  onSelectionChange() {
    console.log('Model selector emitting change:', this.selection);
    this.selectionChange.emit({ ...this.selection });
  }

  private updateAvailableModels() {
    this.availableLLMModels = this.modelsConfig.getModels(this.appName, 'LLM', this.selection.llm.provider);
    this.availableEmbedModels = this.modelsConfig.getModels(this.appName, 'EMBED', this.selection.embed.provider);
  }

  getShortModelName(fullName: string): string {
    // Extract just the model name part after the last slash
    const parts = fullName.split('/');
    return parts[parts.length - 1] || fullName;
  }
}