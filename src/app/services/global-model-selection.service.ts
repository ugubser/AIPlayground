import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ModelsConfigService, RAGModelSelection } from './models-config.service';

@Injectable({
  providedIn: 'root'
})
export class GlobalModelSelectionService {
  private currentSelectionSubject = new BehaviorSubject<RAGModelSelection | null>(null);
  public currentSelection$: Observable<RAGModelSelection | null> = this.currentSelectionSubject.asObservable();

  constructor(private modelsConfig: ModelsConfigService) {
    // Initialize with default selection
    const defaultSelection = this.modelsConfig.getDefaultSelection('rag');
    if (defaultSelection) {
      this.currentSelectionSubject.next(defaultSelection);
    }
  }

  getCurrentSelection(): RAGModelSelection | null {
    return this.currentSelectionSubject.value;
  }

  updateSelection(selection: RAGModelSelection): void {
    console.log('Global service updating selection to:', selection);
    this.currentSelectionSubject.next(selection);
  }

  // Convenience method for components to get current selection synchronously
  getSelectionForRequest(): RAGModelSelection | undefined {
    const selection = this.getCurrentSelection();
    console.log('Getting selection for request:', selection);
    return selection || undefined;
  }
}