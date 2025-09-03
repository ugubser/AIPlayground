import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModelsConfigService, DynamicModelSelection } from '../../services/models-config.service';
import { GlobalModelSelectionService } from '../../services/global-model-selection.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-dynamic-model-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="model-selector">
      <div class="compact-row">
        <div class="model-group-compact" *ngFor="let modelType of modelTypes">
          <label>{{ getDisplayName(modelType) }}:</label>
          <select [(ngModel)]="selection[modelType.toLowerCase()].provider" (ngModelChange)="onProviderChange(modelType)">
            <option *ngFor="let provider of getProviders(modelType)" [value]="provider">
              {{provider}}
            </option>
          </select>
          <select [(ngModel)]="selection[modelType.toLowerCase()].model" (ngModelChange)="onSelectionChange()">
            <option *ngFor="let model of getAvailableModels(modelType)" [value]="model">
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
      gap: var(--space-4);
      flex-wrap: nowrap;
      width: 100%;
    }

    .model-group-compact {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex: 1;
      min-width: 200px;
    }

    .model-group-compact label {
      font-size: 0.75rem;
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      min-width: 45px;
      flex-shrink: 0;
    }

    select {
      flex: 1;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: 0.8125rem;
      font-family: var(--font-family-primary);
      background: var(--color-surface-elevated);
      color: var(--color-text-primary);
      min-width: 120px;
      transition: all var(--transition-fast);
      appearance: none;
      background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23b3b3b3' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e");
      background-position: right var(--space-2) center;
      background-repeat: no-repeat;
      background-size: 1rem;
      padding-right: var(--space-7);
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    select option {
      background: var(--color-surface-elevated);
      color: var(--color-text-primary);
      padding: var(--space-2);
      border: none;
    }
    
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

    @media (max-width: 1024px) {
      .compact-row {
        gap: var(--space-3);
        flex-wrap: wrap;
      }
      
      .model-group-compact {
        min-width: 180px;
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
export class DynamicModelSelectorComponent implements OnInit, OnChanges, OnDestroy {
  @Input() appName: string = 'rag';
  @Input() showCurrentSelection: boolean = true;
  @Output() selectionChange = new EventEmitter<DynamicModelSelection>();

  selection: DynamicModelSelection = {};
  modelTypes: string[] = [];
  
  private mcpSubscription?: Subscription;

  constructor(
    private modelsConfig: ModelsConfigService, 
    private globalModelSelection: GlobalModelSelectionService
  ) {}

  ngOnInit() {
    this.initializeComponent();
    this.subscribeToMcpChanges();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['appName']) {
      this.initializeComponent();
    }
  }
  
  ngOnDestroy() {
    if (this.mcpSubscription) {
      this.mcpSubscription.unsubscribe();
    }
  }

  private initializeComponent() {
    this.modelTypes = this.globalModelSelection.getFilteredModelTypes(this.appName);
    this.resetToDefaults();
  }
  
  private subscribeToMcpChanges() {
    // Subscribe to MCP state changes to update model types for chat app
    this.mcpSubscription = this.globalModelSelection.mcpEnabled$.subscribe(() => {
      if (this.appName === 'chat') {
        this.modelTypes = this.globalModelSelection.getFilteredModelTypes(this.appName);
        this.resetToDefaults();
      }
    });
  }

  getDisplayName(modelType: string): string {
    return modelType.toLowerCase();
  }

  getProviders(modelType: string): string[] {
    return this.modelsConfig.getProviders(this.appName, modelType);
  }

  getAvailableModels(modelType: string): string[] {
    const provider = this.selection[modelType.toLowerCase()]?.provider;
    if (!provider) return [];
    return this.modelsConfig.getModels(this.appName, modelType, provider);
  }

  resetToDefaults() {
    const defaultSelection = this.modelsConfig.getDefaultSelection(this.appName);
    if (defaultSelection) {
      this.selection = { ...defaultSelection };
      this.onSelectionChange();
    }
  }

  onProviderChange(modelType: string) {
    const key = modelType.toLowerCase();
    const availableModels = this.getAvailableModels(modelType);
    if (availableModels.length > 0) {
      this.selection[key].model = availableModels[0];
    }
    this.onSelectionChange();
  }

  onSelectionChange() {
    console.log('Dynamic model selector emitting change:', this.selection);
    this.selectionChange.emit({ ...this.selection });
  }

  getShortModelName(fullName: string): string {
    const parts = fullName.split('/');
    return parts[parts.length - 1] || fullName;
  }
}