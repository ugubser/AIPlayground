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
}