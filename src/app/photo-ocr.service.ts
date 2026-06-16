import { Injectable } from '@angular/core';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';

export interface PhotoOcrExtraction {
  text: string | null;
  confidence: number | null;
}

@Injectable({ providedIn: 'root' })
export class PhotoOcrService {
  private workerPromise: Promise<Worker> | null = null;

  async extractText(photoBlob: Blob): Promise<PhotoOcrExtraction> {
    const worker = await this.getWorker();
    const result = await worker.recognize(photoBlob);
    const text = this.normalizeText(result.data.text);
    const confidence = Number.isFinite(result.data.confidence) ? result.data.confidence : null;

    return {
      text,
      confidence,
    };
  }

  private getWorker(): Promise<Worker> {
    if (this.workerPromise) {
      return this.workerPromise;
    }

    this.workerPromise = this.createConfiguredWorker();
    return this.workerPromise;
  }

  private async createConfiguredWorker(): Promise<Worker> {
    const worker = await createWorker(['eng', 'fra'], OEM.LSTM_ONLY, {
      workerPath: this.buildAssetUrl('ocr/worker.min.js'),
      corePath: this.buildAssetDirectoryUrl('ocr/core'),
      langPath: this.buildAssetDirectoryUrl('ocr/lang'),
      gzip: true,
    });

    await worker.setParameters({
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: PSM.AUTO,
      user_defined_dpi: '300',
    });

    return worker;
  }

  private buildAssetUrl(relativePath: string): string {
    if (typeof document === 'undefined') {
      return relativePath;
    }

    return new URL(relativePath, document.baseURI).toString();
  }

  private buildAssetDirectoryUrl(relativePath: string): string {
    return this.buildAssetUrl(`${relativePath}/`).replace(/\/$/, '');
  }

  private normalizeText(rawText: string): string | null {
    const normalizedText = rawText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return normalizedText.length > 0 ? normalizedText : null;
  }
}
