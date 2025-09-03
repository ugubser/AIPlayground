import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ModelsConfigService, RAGModelSelection, DynamicModelSelection } from './models-config.service';

@Injectable({
  providedIn: 'root'
})
export class GlobalModelSelectionService {
  private currentSelectionSubject = new BehaviorSubject<DynamicModelSelection | null>(null);
  public currentSelection$: Observable<DynamicModelSelection | null> = this.currentSelectionSubject.asObservable();
  
  private currentAppSubject = new BehaviorSubject<string>('rag');
  public currentApp$: Observable<string> = this.currentAppSubject.asObservable();
  
  private mcpEnabledSubject = new BehaviorSubject<boolean>(false);
  public mcpEnabled$: Observable<boolean> = this.mcpEnabledSubject.asObservable();

  constructor(private modelsConfig: ModelsConfigService) {
    // Initialize with default selection
    const defaultSelection = this.modelsConfig.getDefaultSelection('rag');
    if (defaultSelection) {
      this.currentSelectionSubject.next(defaultSelection);
    }
  }

  getCurrentSelection(): DynamicModelSelection | null {
    return this.currentSelectionSubject.value;
  }

  updateSelection(selection: DynamicModelSelection): void {
    console.log('Global service updating selection to:', selection);
    this.currentSelectionSubject.next(selection);
  }

  updateCurrentApp(appName: string): void {
    console.log('Global service updating app to:', appName);
    this.currentAppSubject.next(appName);
    
    // Update model selection to default for the new app
    const defaultSelection = this.modelsConfig.getDefaultSelection(appName);
    if (defaultSelection) {
      this.updateSelection(defaultSelection);
    }
  }

  getCurrentApp(): string {
    return this.currentAppSubject.value;
  }

  // Convenience method for components to get current selection synchronously
  getSelectionForRequest(): DynamicModelSelection | undefined {
    const selection = this.getCurrentSelection();
    console.log('Getting selection for request:', selection);
    return selection || undefined;
  }

  // Backwards compatibility method for RAG components that expect RAGModelSelection
  getRAGSelectionForRequest(): RAGModelSelection | undefined {
    const selection = this.getCurrentSelection();
    if (!selection || !selection['llm'] || !selection['embed']) {
      return undefined;
    }
    
    return {
      llm: selection['llm'],
      embed: selection['embed']
    };
  }

  getModelsConfig(): ModelsConfigService {
    return this.modelsConfig;
  }

  updateMcpEnabled(enabled: boolean): void {
    console.log('Global service updating MCP enabled to:', enabled);
    this.mcpEnabledSubject.next(enabled);
    
    // Update model selection to appropriate type for current app
    const currentApp = this.getCurrentApp();
    if (currentApp === 'chat') {
      const defaultSelection = this.getFilteredDefaultSelection(currentApp, enabled);
      if (defaultSelection) {
        this.updateSelection(defaultSelection);
      }
    }
  }

  getMcpEnabled(): boolean {
    return this.mcpEnabledSubject.value;
  }

  // Get filtered model types based on app and MCP state
  getFilteredModelTypes(appName: string): string[] {
    const allTypes = this.modelsConfig.getModelTypes(appName);
    
    if (appName === 'chat') {
      const mcpEnabled = this.getMcpEnabled();
      // If MCP is enabled, only show MCP models; otherwise only show LLM models
      return allTypes.filter(type => 
        mcpEnabled ? type === 'MCP' : type === 'LLM'
      );
    }
    
    // For other apps, return all model types
    return allTypes;
  }

  // Get filtered default selection based on MCP state
  private getFilteredDefaultSelection(appName: string, mcpEnabled: boolean): DynamicModelSelection | null {
    const filteredTypes = this.getFilteredModelTypes(appName);
    if (filteredTypes.length === 0) return null;

    const selection: DynamicModelSelection = {};
    
    for (const modelType of filteredTypes) {
      const providers = this.modelsConfig.getProviders(appName, modelType);
      if (providers.length > 0) {
        const firstProvider = providers[0];
        const models = this.modelsConfig.getModels(appName, modelType, firstProvider);
        if (models.length > 0) {
          selection[modelType.toLowerCase()] = {
            provider: firstProvider,
            model: models[0]
          };
        }
      }
    }
    
    return Object.keys(selection).length > 0 ? selection : null;
  }
}