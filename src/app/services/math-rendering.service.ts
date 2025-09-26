import { Injectable } from '@angular/core';

interface MathSegment {
  type: 'text' | 'math';
  content: string;
  display: boolean;
}

interface MathJaxInstance {
  tex2svgPromise?: (math: string, options?: { display?: boolean }) => Promise<HTMLElement>;
  startup?: {
    promise?: Promise<void>;
    getComponents?: () => void;
  };
}

@Injectable({ providedIn: 'root' })
export class MathRenderingService {
  private mathJaxLoader?: Promise<MathJaxInstance>;
  private readonly cache = new Map<string, string>();

  async transformMarkdown(markdown: string | undefined | null): Promise<string> {
    if (!markdown) {
      return markdown ?? '';
    }

    const hasMath = this.containsMath(markdown);
    const hasSvg = this.containsSvg(markdown);

    if (!hasMath && !hasSvg) {
      return markdown;
    }

    let workingContent = hasSvg ? this.convertSvgCodeFences(markdown) : markdown;

    const segments = this.extractSegments(workingContent);
    if (!segments.some(segment => segment.type === 'math')) {
      return markdown;
    }

    const mathJax = await this.loadMathJax();
    const renderedParts: string[] = [];

    for (const segment of segments) {
      if (segment.type === 'text') {
        let processed = this.convertSvgCodeFences(segment.content);
        processed = this.convertInlineSvgs(processed);
        renderedParts.push(processed);
        continue;
      }

      const cacheKey = `${segment.display ? 'block' : 'inline'}::${segment.content}`;
      let rendered = this.cache.get(cacheKey);

      if (!rendered) {
        rendered = await this.renderSegment(mathJax, segment.content, segment.display);
        this.cache.set(cacheKey, rendered);
      }

      renderedParts.push(rendered);
    }

    return renderedParts.join('');
  }

  private convertInlineSvgs(input: string): string {
    const svgRegex = /(?:<\?xml[^>]*\?>\s*)?<svg[\s\S]*?<\/svg>/gi;

    return input.replace(svgRegex, match => {
      const svgContent = match.replace(/^[^<]*<\?xml[^>]*\?>\s*/i, '').trim();

      if (!svgContent.startsWith('<svg')) {
        return match;
      }

      try {
        const dataUri = this.svgToDataUri(svgContent);
        const titleMatch = svgContent.match(/<title>([\s\S]*?)<\/title>/i);
        const alt = this.createAltText(titleMatch ? titleMatch[1] : 'Generated SVG graphic');
        return `\n<div class="svg-embedded-block"><img class="svg-embedded-image" src="${dataUri}" alt="${alt}"></div>\n`;
      } catch (error) {
        console.warn('Failed to embed inline SVG, leaving original markup', { error });
        return match;
      }
    });
  }

  private convertSvgCodeFences(input: string): string {
    const fenceRegex = /```svg\s+([\s\S]*?)```/gi;

    return input.replace(fenceRegex, (match, rawContent) => {
      const trimmed = rawContent.trim();
      if (!trimmed) {
        return match;
      }

      const svgContent = trimmed.replace(/^[^<]*<\?xml[^>]*\?>\s*/i, '');
      if (!svgContent.trim().toLowerCase().startsWith('<svg')) {
        return match;
      }

      try {
        const dataUri = this.svgToDataUri(svgContent.trim());
        const titleMatch = svgContent.match(/<title>([\s\S]*?)<\/title>/i);
        const alt = this.createAltText(titleMatch ? titleMatch[1] : 'Generated SVG graphic');
        return `\n<div class="svg-embedded-block"><img class="svg-embedded-image" src="${dataUri}" alt="${alt}"></div>\n`;
      } catch (error) {
        console.warn('Failed to embed SVG code fence, leaving original content', { error });
        return match;
      }
    });
  }

  private containsMath(input: string): boolean {
    return /\$\$|\\\[|\\\(|\$(?=\S)/.test(input);
  }

  private containsSvg(input: string): boolean {
    return /```svg|<svg[\s>]/i.test(input);
  }

  private extractSegments(input: string): MathSegment[] {
    const segments: MathSegment[] = [];
    let buffer = '';
    let index = 0;

    const flushText = () => {
      if (buffer) {
        segments.push({ type: 'text', content: buffer, display: false });
        buffer = '';
      }
    };

    const length = input.length;

    while (index < length) {
      // Preserve fenced code blocks untouched
      if (input.startsWith('```', index)) {
        const endIndex = input.indexOf('```', index + 3);
        const blockEnd = endIndex === -1 ? length : endIndex + 3;
        buffer += input.slice(index, blockEnd);
        index = blockEnd;
        continue;
      }

      // Preserve inline code
      if (input[index] === '`') {
        const endIndex = input.indexOf('`', index + 1);
        if (endIndex === -1) {
          buffer += input.slice(index);
          break;
        }
        buffer += input.slice(index, endIndex + 1);
        index = endIndex + 1;
        continue;
      }

      // Block math with $$ ... $$
      if (input.startsWith('$$', index)) {
        const closing = input.indexOf('$$', index + 2);
        if (closing !== -1) {
          const mathContent = input.slice(index + 2, closing);
          flushText();
          segments.push({ type: 'math', content: mathContent.trim(), display: true });
          index = closing + 2;
          continue;
        }
      }

      // Block math with \[ ... \]
      if (input.startsWith('\\[', index)) {
        const closing = input.indexOf('\\]', index + 2);
        if (closing !== -1) {
          const mathContent = input.slice(index + 2, closing);
          flushText();
          segments.push({ type: 'math', content: mathContent.trim(), display: true });
          index = closing + 2;
          continue;
        }
      }

      // Inline math with \( ... \)
      if (input.startsWith('\\(', index)) {
        const closing = input.indexOf('\\)', index + 2);
        if (closing !== -1) {
          const mathContent = input.slice(index + 2, closing);
          flushText();
          segments.push({ type: 'math', content: mathContent.trim(), display: false });
          index = closing + 2;
          continue;
        }
      }

      // Inline math with $ ... $
      if (input[index] === '$' && !this.isEscaped(input, index) && !input.startsWith('$$', index)) {
        const closing = this.findInlineDollar(input, index + 1);
        if (closing !== -1) {
          const mathContent = input.slice(index + 1, closing);
          if (mathContent.trim().length > 0) {
            flushText();
            segments.push({ type: 'math', content: mathContent.trim(), display: false });
            index = closing + 1;
            continue;
          }
        }
      }

      buffer += input[index];
      index += 1;
    }

    if (buffer) {
      segments.push({ type: 'text', content: buffer, display: false });
    }

    return segments;
  }

  private isEscaped(input: string, position: number): boolean {
    let backslashCount = 0;
    let idx = position - 1;
    while (idx >= 0 && input[idx] === '\\') {
      backslashCount += 1;
      idx -= 1;
    }
    return backslashCount % 2 === 1;
  }

  private findInlineDollar(input: string, start: number): number {
    let index = start;
    while (index < input.length) {
      const char = input[index];
      if (char === '$' && !this.isEscaped(input, index)) {
        return index;
      }
      if (char === '\n') {
        return -1;
      }
      index += 1;
    }
    return -1;
  }

  private async renderSegment(mathJax: MathJaxInstance, expression: string, display: boolean): Promise<string> {
    try {
      if (!mathJax.tex2svgPromise) {
        throw new Error('MathJax SVG renderer not available');
      }

      const svgWrapper = await mathJax.tex2svgPromise(expression, { display });
      const svgMarkup = this.extractSvgMarkup(svgWrapper);
      const normalizedSvg = svgMarkup.replace(/\s+/g, ' ').trim();
      const coloredSvg = this.applyMathColor(normalizedSvg);
      const dataUri = this.svgToDataUri(coloredSvg);
      const altText = this.createAltText(expression);

      if (display) {
        return `\n<div class="math-render-block"><img class="math-render-image" src="${dataUri}" alt="${altText}"></div>\n`;
      }
      return `<span class="math-render-inline"><img class="math-render-inline-image" src="${dataUri}" alt="${altText}"></span>`;
    } catch (error) {
      console.warn('Math rendering failed, falling back to raw expression', { expression, error });
      if (display) {
        return `\n\n$$${expression}$$\n\n`;
      }
      return `$${expression}$`;
    }
  }

  private extractSvgMarkup(svgWrapper: any): string {
    const global = typeof window !== 'undefined' ? (window as any) : undefined;
    const adaptor = global?.MathJax?.startup?.adaptor;

    if (adaptor) {
      try {
        const firstChild = adaptor.firstChild(svgWrapper);
        if (firstChild && adaptor.kind(firstChild) === 'svg') {
          return adaptor.outerHTML(firstChild);
        }
      } catch (error) {
        console.warn('MathJax adaptor failed to extract SVG element', error);
      }
    }

    if (svgWrapper?.querySelector) {
      const svgElement = svgWrapper.querySelector('svg');
      if (svgElement) {
        return svgElement.outerHTML;
      }
    }

    if (svgWrapper && typeof svgWrapper.outerHTML === 'string' && svgWrapper.outerHTML.trim().startsWith('<svg')) {
      return svgWrapper.outerHTML;
    }

    throw new Error('Unable to obtain SVG markup from MathJax output');
  }

  private svgToDataUri(svg: string): string {
    if (typeof window === 'undefined' || typeof btoa !== 'function') {
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    try {
      const encoded = btoa(unescape(encodeURIComponent(svg)));
      return `data:image/svg+xml;base64,${encoded}`;
    } catch (error) {
      console.warn('Failed to encode SVG as base64, falling back to UTF-8 data URI', error);
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }
  }

  private createAltText(expression: string): string {
    return expression
      .replace(/\s+/g, ' ')
      .replace(/"/g, '&quot;')
      .trim();
  }

  private applyMathColor(svg: string): string {
    const hasColorAttr = /\bcolor\s*=|\bcolor\s*:/.test(svg);
    if (hasColorAttr) {
      return svg;
    }

    const styleMatch = svg.match(/<svg[^>]*style=["']([^"']*)["']/i);
    if (styleMatch) {
      const existingStyle = styleMatch[1];
      const updatedStyle = `color:#ffffff;${existingStyle}`;
      return svg.replace(styleMatch[0], styleMatch[0].replace(existingStyle, updatedStyle));
    }

    return svg.replace('<svg', '<svg style="color:#ffffff;"');
  }

  private loadMathJax(): Promise<MathJaxInstance> {
    if (typeof window === 'undefined') {
      return Promise.resolve({});
    }

    const existing = (window as any).MathJax as MathJaxInstance | undefined;
    if (existing && existing.tex2svgPromise) {
      return existing.startup?.promise ? existing.startup.promise.then(() => existing) : Promise.resolve(existing);
    }

    if (!this.mathJaxLoader) {
      this.mathJaxLoader = new Promise<MathJaxInstance>((resolve, reject) => {
        const global = window as any;
        if (!global.MathJax) {
          global.MathJax = {
            startup: {
              typeset: false
            },
            svg: {
              fontCache: 'none'
            },
            options: {
              enableMenu: false
            },
            tex: {
              inlineMath: [ ['$', '$'], ['\\\(', '\\\)'] ],
              displayMath: [ ['$$', '$$'], ['\\[', '\\]'] ],
              packages: { '[+]': ['noerrors', 'noundefined'] }
            }
          };
        }

        const scriptId = 'mathjax-svg-script';
        const existingScript = document.getElementById(scriptId);
        if (existingScript) {
          existingScript.addEventListener('load', () => {
            const loaded = (window as any).MathJax as MathJaxInstance;
            if (loaded?.startup?.promise) {
              loaded.startup.promise.then(() => resolve(loaded)).catch(reject);
            } else {
              resolve(loaded ?? {});
            }
          });
          existingScript.addEventListener('error', reject);
          return;
        }

        const script = document.createElement('script');
        script.id = scriptId;
        script.type = 'text/javascript';
        script.async = true;
        script.defer = true;
        script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';
        script.onload = () => {
          const loaded = (window as any).MathJax as MathJaxInstance;
          if (loaded?.startup?.promise) {
            loaded.startup.promise.then(() => resolve(loaded)).catch(reject);
          } else {
            resolve(loaded ?? {});
          }
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    return this.mathJaxLoader;
  }
}
