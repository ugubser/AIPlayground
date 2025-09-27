import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth, connectAuthEmulator } from '@angular/fire/auth';
import { getFirestore, provideFirestore, connectFirestoreEmulator } from '@angular/fire/firestore';
import { getStorage, provideStorage, connectStorageEmulator } from '@angular/fire/storage';
import { getFunctions, provideFunctions, connectFunctionsEmulator } from '@angular/fire/functions';
import { provideMarkdown, MARKED_OPTIONS, MarkedOptions, MarkedRenderer } from 'ngx-markdown';

import { routes } from './app.routes';
import { environment } from '../environments/environment';

function svgMarkedOptionsFactory(): MarkedOptions {
  const renderer = new MarkedRenderer();
  const defaultCode = renderer.code?.bind(renderer);

  renderer.code = (code: string, infostring?: string, escaped?: boolean) => {
    const language = (infostring || '').trim().toLowerCase();

    if (language === 'svg') {
      const svgContent = code.trim();
      if (!svgContent.toLowerCase().startsWith('<svg')) {
        return defaultCode ? defaultCode(code, infostring, escaped ?? false) ?? '' : code;
      }

      try {
        const dataUri = svgToDataUri(svgContent);
        const titleMatch = svgContent.match(/<title>([\s\S]*?)<\/title>/i);
        const alt = createAltText(titleMatch ? titleMatch[1] : 'Generated SVG graphic');
        return `\n<div class="svg-embedded-block"><img class="svg-embedded-image" src="${dataUri}" alt="${alt}"></div>\n`;
      } catch (error) {
        console.warn('Failed to render SVG code block', error);
        return defaultCode ? defaultCode(code, infostring, escaped ?? false) ?? '' : code;
      }
    }

    return defaultCode ? defaultCode(code, infostring, escaped ?? false) ?? '' : code;
  };

  return { renderer };
}

function svgToDataUri(svg: string): string {
  if (typeof window === 'undefined' || typeof btoa !== 'function') {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  try {
    const encoded = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${encoded}`;
  } catch (error) {
    console.warn('Falling back to UTF-8 data URI for SVG', error);
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
}

function createAltText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/"/g, '&quot;')
    .trim();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    provideMarkdown(),
    {
      provide: MARKED_OPTIONS,
      useFactory: svgMarkedOptionsFactory
    },
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const auth = getAuth();
      if (environment.useEmulator) {
        try {
          connectAuthEmulator(auth, 'http://localhost:9099');
        } catch (error) {
          console.warn('Auth emulator connection failed:', error);
        }
      }
      return auth;
    }),
    provideFirestore(() => {
      const firestore = getFirestore();
      if (environment.useEmulator) {
        connectFirestoreEmulator(firestore, 'localhost', 8080);
      }
      return firestore;
    }),
    provideStorage(() => {
      const storage = getStorage();
      if (environment.useEmulator) {
        connectStorageEmulator(storage, 'localhost', 9199);
      }
      return storage;
    }),
    provideFunctions(() => {
      const functions = getFunctions();
      if (environment.useEmulator) {
        try {
          connectFunctionsEmulator(functions, 'localhost', 5001);
        } catch (error) {
          console.warn('Functions emulator connection failed, might already be connected:', error);
        }
      }
      return functions;
    })
  ]
};
