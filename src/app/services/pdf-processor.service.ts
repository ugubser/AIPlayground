import { Injectable } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { APP_CONSTANTS } from '../config/app-constants';
import { LoggingService } from './logging.service';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.js';

export interface ChunkData {
  text: string;
  page: number;
  chunkIndex: number;
}

@Injectable({
  providedIn: 'root'
})
export class PdfProcessorService {

  constructor(private logger: LoggingService) { }

  async pdfToTextByPage(file: File): Promise<string[]> {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages: string[] = [];
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pages.push(text);
    }
    
    return pages;
  }

  async chunkPages(pages: string[]): Promise<ChunkData[]> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: APP_CONSTANTS.PDF_PROCESSING.CHUNK_SIZE,
      chunkOverlap: APP_CONSTANTS.PDF_PROCESSING.CHUNK_OVERLAP,
      separators: ['\n\n', '\n', ' ', '']
    });

    const chunks: ChunkData[] = [];
    let chunkIndex = 0;

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const pageText = pages[pageIndex];
      if (pageText.trim().length === 0) continue;

      const pageChunks = await splitter.splitText(pageText);
      
      for (const chunkText of pageChunks) {
        chunks.push({
          text: chunkText.trim(),
          page: pageIndex + 1,
          chunkIndex: chunkIndex++
        });
      }
    }

    return chunks;
  }

  async processPdfFile(file: File): Promise<ChunkData[]> {
    try {
      this.logger.info('Processing PDF file', { filename: file.name, size: file.size });
      const startTime = Date.now();
      
      const pages = await this.pdfToTextByPage(file);
      this.logger.debug('PDF text extraction complete', { pageCount: pages.length });
      
      const chunks = await this.chunkPages(pages);
      
      this.logger.logPerformance('PDF Processing', startTime, { 
        filename: file.name, 
        pageCount: pages.length, 
        chunkCount: chunks.length 
      });
      
      return chunks;
    } catch (error) {
      this.logger.error('Error processing PDF', { filename: file.name, error });
      throw error;
    }
  }
}