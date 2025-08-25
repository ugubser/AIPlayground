import { Injectable } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

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

  constructor() { }

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
      chunkSize: 400,  // Reduced to stay well under 512 token limit
      chunkOverlap: 50, // Reduced proportionally
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
      console.log(`Processing PDF: ${file.name}`);
      const pages = await this.pdfToTextByPage(file);
      console.log(`Extracted text from ${pages.length} pages`);
      
      const chunks = await this.chunkPages(pages);
      console.log(`Created ${chunks.length} chunks`);
      
      return chunks;
    } catch (error) {
      console.error('Error processing PDF:', error);
      throw error;
    }
  }
}