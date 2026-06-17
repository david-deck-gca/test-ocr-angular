import { Injectable } from '@angular/core';

export interface PhotoCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}

export type PhotoOcrStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface PendingPhotoOcrJob {
  id: string;
  blob: Blob;
}

export interface PhotoOcrUpdate {
  text: string | null;
  confidence: number | null;
}

interface StoredPhotoRecord {
  id: string;
  createdAt: string;
  blob: Blob;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  coordinateCapturedAt: string | null;
  ocrText: string | null;
  ocrConfidence: number | null;
  ocrStatus: PhotoOcrStatus;
}

type StoredPhotoRecordLike = Omit<StoredPhotoRecord, 'ocrText' | 'ocrConfidence' | 'ocrStatus'> & {
  ocrText?: string | null;
  ocrConfidence?: number | null;
  ocrStatus?: PhotoOcrStatus;
};

export interface SavedPhoto {
  id: string;
  createdAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  coordinateCapturedAt: string | null;
  ocrText: string | null;
  ocrConfidence: number | null;
  ocrStatus: PhotoOcrStatus;
  previewUrl: string;
}

@Injectable({ providedIn: 'root' })
export class PhotoStorageService {
  private readonly databaseName = 'offline-photo-log';
  private readonly storeName = 'photos';
  private readonly databaseVersion = 2;
  private readonly fallbackRecords: StoredPhotoRecord[] = [];
  private readonly previewUrls = new Map<string, string>();

  private databasePromise: Promise<IDBDatabase> | null = null;

  async savePhoto(blob: Blob, coordinates: PhotoCoordinates | null): Promise<string> {
    const record: StoredPhotoRecord = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      blob,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      accuracy: coordinates?.accuracy ?? null,
      coordinateCapturedAt: coordinates?.capturedAt ?? null,
      ocrText: null,
      ocrConfidence: null,
      ocrStatus: 'pending',
    };

    if (!this.isIndexedDbSupported()) {
      this.fallbackRecords.unshift(record);
      return record.id;
    }

    await this.withStore('readwrite', (store) => this.requestToPromise(store.put(record)));
    return record.id;
  }

  async loadPhotos(): Promise<SavedPhoto[]> {
    const records = this.isIndexedDbSupported()
      ? await this.withStore('readonly', (store) => this.requestToPromise(store.getAll()))
      : [...this.fallbackRecords];

    const normalizedRecords = records.map((record) => this.normalizeRecord(record));

    const sortedRecords = normalizedRecords.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const activeIds = new Set(sortedRecords.map((record) => record.id));

    for (const [id, previewUrl] of this.previewUrls) {
      if (activeIds.has(id)) {
        continue;
      }

      this.revokeObjectUrl(previewUrl);
      this.previewUrls.delete(id);
    }

    return sortedRecords.map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      latitude: record.latitude,
      longitude: record.longitude,
      accuracy: record.accuracy,
      coordinateCapturedAt: record.coordinateCapturedAt,
      ocrText: record.ocrText,
      ocrConfidence: record.ocrConfidence,
      ocrStatus: record.ocrStatus,
      previewUrl: this.createPreviewUrl(record.id, record.blob),
    }));
  }

  async loadPhotosNeedingOcr(): Promise<PendingPhotoOcrJob[]> {
    const records = this.isIndexedDbSupported()
      ? await this.withStore('readonly', (store) => this.requestToPromise(store.getAll()))
      : [...this.fallbackRecords];

    return records
      .map((record) => this.normalizeRecord(record))
      .filter((record) => record.ocrStatus === 'pending')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => ({
        id: record.id,
        blob: record.blob,
      }));
  }

  async loadPhotoOcrJob(id: string): Promise<PendingPhotoOcrJob | null> {
    if (this.isIndexedDbSupported()) {
      return this.withStore('readonly', async (store) => {
        const existingRecord = await this.requestToPromise(store.get(id));

        if (!existingRecord) {
          return null;
        }

        const record = this.normalizeRecord(existingRecord);
        return {
          id: record.id,
          blob: record.blob,
        };
      });
    }

    const matchingRecord = this.fallbackRecords.find((record) => record.id === id);

    if (!matchingRecord) {
      return null;
    }

    return {
      id: matchingRecord.id,
      blob: matchingRecord.blob,
    };
  }

  async markPhotoOcrProcessing(id: string): Promise<void> {
    await this.updatePhotoRecord(id, (record) => ({
      ...record,
      ocrStatus: 'processing',
    }));
  }

  async completePhotoOcr(id: string, update: PhotoOcrUpdate): Promise<void> {
    await this.updatePhotoRecord(id, (record) => ({
      ...record,
      ocrText: update.text,
      ocrConfidence: update.confidence,
      ocrStatus: 'done',
    }));
  }

  async failPhotoOcr(id: string): Promise<void> {
    await this.updatePhotoRecord(id, (record) => ({
      ...record,
      ocrText: null,
      ocrConfidence: null,
      ocrStatus: 'failed',
    }));
  }

  async resetProcessingPhotosToPending(): Promise<void> {
    if (this.isIndexedDbSupported()) {
      await this.withStore('readwrite', async (store) => {
        const records = await this.requestToPromise(store.getAll());

        for (const record of records.map((item) => this.normalizeRecord(item))) {
          if (record.ocrStatus !== 'processing') {
            continue;
          }

          await this.requestToPromise(
            store.put({
              ...record,
              ocrStatus: 'pending',
            }),
          );
        }
      });

      return;
    }

    for (const [index, record] of this.fallbackRecords.entries()) {
      if (record.ocrStatus !== 'processing') {
        continue;
      }

      this.fallbackRecords.splice(index, 1, {
        ...record,
        ocrStatus: 'pending',
      });
    }
  }

  async preparePhotoOcrRetry(id: string): Promise<PendingPhotoOcrJob | null> {
    return this.updatePhotoRecord(id, (record) => ({
      ...record,
      ocrText: null,
      ocrConfidence: null,
      ocrStatus: 'pending',
    }), true);
  }

  async deletePhoto(id: string): Promise<void> {
    if (this.isIndexedDbSupported()) {
      await this.withStore('readwrite', (store) => this.requestToPromise(store.delete(id)));
    } else {
      const matchingIndex = this.fallbackRecords.findIndex((record) => record.id === id);

      if (matchingIndex >= 0) {
        this.fallbackRecords.splice(matchingIndex, 1);
      }
    }

    const previewUrl = this.previewUrls.get(id);

    if (previewUrl) {
      this.revokeObjectUrl(previewUrl);
      this.previewUrls.delete(id);
    }
  }

  private isIndexedDbSupported(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private async withStore<Result>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<Result>,
  ): Promise<Result> {
    const database = await this.openDatabase();
    const transaction = database.transaction(this.storeName, mode);
    const store = transaction.objectStore(this.storeName);
    const result = await operation(store);
    await this.waitForTransaction(transaction);
    return result;
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) {
      return this.databasePromise;
    }

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, this.databaseVersion);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName, { keyPath: 'id' });
          return;
        }

        this.migrateExistingRecords(request);
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'));
    });

    return this.databasePromise;
  }

  private requestToPromise<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  }

  private waitForTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
    });
  }

  private createPreviewUrl(id: string, blob: Blob): string {
    const previousPreviewUrl = this.previewUrls.get(id);

    if (previousPreviewUrl) {
      this.revokeObjectUrl(previousPreviewUrl);
    }

    if (typeof URL.createObjectURL !== 'function') {
      return '';
    }

    const previewUrl = URL.createObjectURL(blob);
    this.previewUrls.set(id, previewUrl);
    return previewUrl;
  }

  private revokeObjectUrl(previewUrl: string): void {
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(previewUrl);
    }
  }

  private async updatePhotoRecord(
    id: string,
    updater: (record: StoredPhotoRecord) => StoredPhotoRecord,
    returnPendingJob = false,
  ): Promise<PendingPhotoOcrJob | null> {
    if (this.isIndexedDbSupported()) {
      return this.withStore('readwrite', async (store) => {
        const existingRecord = await this.requestToPromise(store.get(id));

        if (!existingRecord) {
          return null;
        }

        const updatedRecord = updater(this.normalizeRecord(existingRecord));
        await this.requestToPromise(store.put(updatedRecord));

        return returnPendingJob
          ? {
              id: updatedRecord.id,
              blob: updatedRecord.blob,
            }
          : null;
      });
    }

    const recordIndex = this.fallbackRecords.findIndex((record) => record.id === id);

    if (recordIndex < 0) {
      return null;
    }

    const updatedRecord = updater(this.normalizeRecord(this.fallbackRecords[recordIndex]));
    this.fallbackRecords.splice(recordIndex, 1, updatedRecord);

    return returnPendingJob
      ? {
          id: updatedRecord.id,
          blob: updatedRecord.blob,
        }
      : null;
  }

  private migrateExistingRecords(request: IDBOpenDBRequest): void {
    const transaction = request.transaction;

    if (!transaction) {
      return;
    }

    const store = transaction.objectStore(this.storeName);
    const cursorRequest = store.openCursor();

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;

      if (!cursor) {
        return;
      }

      cursor.update(this.normalizeRecord(cursor.value as StoredPhotoRecordLike));
      cursor.continue();
    };
  }

  private normalizeRecord(record: StoredPhotoRecordLike): StoredPhotoRecord {
    return {
      id: record.id,
      createdAt: record.createdAt,
      blob: record.blob,
      latitude: record.latitude,
      longitude: record.longitude,
      accuracy: record.accuracy,
      coordinateCapturedAt: record.coordinateCapturedAt,
      ocrText: record.ocrText ?? null,
      ocrConfidence: record.ocrConfidence ?? null,
      ocrStatus: record.ocrStatus ?? 'pending',
    };
  }
}
