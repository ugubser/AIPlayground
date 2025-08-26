import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';
import { GlobalModelSelectionService } from './services/global-model-selection.service';
import { ModelSelectorComponent } from './components/model-selector/model-selector.component';
import { RAGModelSelection } from './services/models-config.service';
import { Observable } from 'rxjs';
import { User } from '@angular/fire/auth';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, ModelSelectorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'Firebase RAG Chatbot';
  user$: Observable<User | null>;
  loading = false;

  constructor(
    private authService: AuthService,
    private globalModelSelection: GlobalModelSelectionService
  ) {
    this.user$ = this.authService.user$;
  }

  ngOnInit() {
    // Auto sign-in anonymously if not authenticated
    this.user$.subscribe(user => {
      if (!user && !this.loading) {
        this.signInAnonymously();
      }
    });
  }

  async signInAnonymously() {
    this.loading = true;
    try {
      await this.authService.signInAnonymously();
    } catch (error) {
      console.error('Failed to sign in:', error);
    } finally {
      this.loading = false;
    }
  }

  async signOut() {
    try {
      await this.authService.signOut();
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
  }

  onGlobalModelSelectionChange(selection: RAGModelSelection) {
    console.log('App component received model selection change:', selection);
    this.globalModelSelection.updateSelection(selection);
  }
}
