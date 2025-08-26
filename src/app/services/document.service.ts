import { Injectable } from '@angular/core';
import { Firestore, collection, doc, setDoc, addDoc, updateDoc, getDocs, query, where, orderBy } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { ChunkData } from './pdf-processor.service';
import { GlobalModelSelectionService } from './global-model-selection.service';

export interface DocumentData {
  id?: string;
  uid: string;
  filename: string;
  bucketPath: string;
  pageCount: number;
  status: 'processing' | 'completed' | 'error';
  createdAt: Date;
  uploadUrl?: string;
}

export interface ChunkWithEmbedding extends ChunkData {
  id?: string;
  docId: string;
  uid: string;
  embedding: number[];
}

@Injectable({
  providedIn: 'root'
})
export class DocumentService {
  private embedChunks = httpsCallable<{texts: string[], provider?: string, model?: string}, {vectors: number[][]}>(this.functions, 'embedChunks');

  constructor(
    private firestore: Firestore,
    private storage: Storage,
    private functions: Functions,
    private auth: Auth,
    private globalModelSelection: GlobalModelSelectionService
  ) { }

  async uploadPdf(file: File): Promise<string> {
    if (!this.auth.currentUser) {
      throw new Error('User not authenticated');
    }

    const uid = this.auth.currentUser.uid;
    const timestamp = Date.now();
    const filename = `${timestamp}_${file.name}`;
    const bucketPath = `documents/${uid}/${filename}`;
    
    const storageRef = ref(this.storage, bucketPath);
    await uploadBytes(storageRef, file);
    const uploadUrl = await getDownloadURL(storageRef);

    const documentData: DocumentData = {
      uid,
      filename: file.name,
      bucketPath,
      pageCount: 0, // Will be updated after processing
      status: 'processing',
      createdAt: new Date(),
      uploadUrl
    };

    const docRef = await addDoc(collection(this.firestore, 'documents'), documentData);
    return docRef.id;
  }

  async saveChunksWithEmbeddings(docId: string, chunks: ChunkData[]): Promise<void> {
    if (!this.auth.currentUser) {
      throw new Error('User not authenticated');
    }

    const uid = this.auth.currentUser.uid;
    const batchSize = 64; // Process embeddings in batches
    const chunksCollection = collection(this.firestore, `documents/${docId}/chunks`);

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(chunk => chunk.text);
      
      try {
        console.log(`Getting embeddings for batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(chunks.length/batchSize)}`);
        
        // Get current model selection for embeddings
        const modelSelection = this.globalModelSelection.getCurrentSelection();
        const embedRequest: any = { texts };
        
        if (modelSelection?.['embed']) {
          embedRequest.provider = modelSelection['embed'].provider;
          embedRequest.model = modelSelection['embed'].model;
        }
        
        const { data } = await this.embedChunks(embedRequest);
        
        const promises = batch.map(async (chunk, index) => {
          const chunkWithEmbedding: Omit<ChunkWithEmbedding, 'id'> = {
            ...chunk,
            docId,
            uid,
            embedding: data.vectors[index] || []
          };
          
          return addDoc(chunksCollection, chunkWithEmbedding);
        });

        await Promise.all(promises);
      } catch (error) {
        console.error('Error getting embeddings for batch:', error);
        throw error;
      }
    }
  }

  async updateDocumentStatus(docId: string, status: DocumentData['status'], pageCount?: number): Promise<void> {
    const docRef = doc(this.firestore, `documents/${docId}`);
    const updateData: Partial<DocumentData> = { status };
    if (pageCount !== undefined) {
      updateData.pageCount = pageCount;
    }
    await updateDoc(docRef, updateData);
  }

  async getUserDocuments(): Promise<DocumentData[]> {
    if (!this.auth.currentUser) {
      return [];
    }

    const uid = this.auth.currentUser.uid;
    const q = query(
      collection(this.firestore, 'documents'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc')
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data['createdAt']?.toDate ? data['createdAt'].toDate() : new Date(data['createdAt'])
      } as DocumentData;
    });
  }
}