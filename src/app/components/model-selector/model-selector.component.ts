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
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 6px;
      padding: 8px 12px;
      margin: 0;
      font-size: 12px;
    }

    .compact-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: nowrap;
    }

    .model-group-compact {
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .model-group-compact label {
      font-size: 11px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.9);
      min-width: auto;
    }

    select {
      padding: 4px 6px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 3px;
      font-size: 11px;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      min-width: 80px;
      max-width: 120px;
    }

    select option {
      background: #333;
      color: white;
    }

    select:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.6);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
    }

    .reset-btn-compact {
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: white;
      padding: 4px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
    }

    .reset-btn-compact:hover {
      background: rgba(255, 255, 255, 0.3);
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