import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, NavigationEnd, Router } from '@angular/router';
import { AuthService } from './services/auth.service';
import { GlobalModelSelectionService } from './services/global-model-selection.service';
import { DynamicModelSelectorComponent } from './components/dynamic-model-selector/dynamic-model-selector.component';
import { DynamicModelSelection } from './services/models-config.service';
import { Observable } from 'rxjs';
import { User } from '@angular/fire/auth';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, DynamicModelSelectorComponent],
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
    // Subscribe to current app changes
    this.globalModelSelection.currentApp$.subscribe(appName => {
      this.currentAppName = appName;
    });
  }

  async signInWithGoogle() {
    this.loading = true;
    try {
      await this.authService.signInWithGoogle();
    } catch (error) {
      console.error('Failed to sign in with Google:', error);
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

  onGlobalModelSelectionChange(selection: DynamicModelSelection) {
    console.log('App component received model selection change:', selection);
    this.globalModelSelection.updateSelection(selection);
  }
}
