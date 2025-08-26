import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, NavigationEnd, Router } from '@angular/router';
import { AuthService } from './services/auth.service';
import { GlobalModelSelectionService } from './services/global-model-selection.service';
import { ModelSelectorComponent } from './components/model-selector/model-selector.component';
import { RAGModelSelection } from './services/models-config.service';
import { Observable } from 'rxjs';
import { User } from '@angular/fire/auth';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, ModelSelectorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'Vanguard Signals AI Playground';
  user$: Observable<User | null>;
  loading = false;
  currentAppName = 'rag';

  constructor(
    private authService: AuthService,
    private globalModelSelection: GlobalModelSelectionService,
    private router: Router
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

    // Subscribe to current app changes
    this.globalModelSelection.currentApp$.subscribe(appName => {
      this.currentAppName = appName;
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
