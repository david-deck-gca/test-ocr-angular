import { Injectable } from '@angular/core';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';

type LoadedRasterImage = HTMLImageElement | ImageBitmap;

export interface PhotoOcrExtraction {
  text: string | null;
  confidence: number | null;
}

@Injectable({ providedIn: 'root' })
export class PhotoOcrService {
  private readonly minimumRecognitionDimension = 1200;
  private readonly maximumUpscaleFactor = 8;
  private workerPromise: Promise<Worker> | null = null;

  async extractText(photoBlob: Blob): Promise<PhotoOcrExtraction> {
    const worker = await this.getWorker();
    const recognitionInput = await this.prepareRecognitionInput(photoBlob);
    const result = await worker.recognize(recognitionInput);
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
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
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

  private async prepareRecognitionInput(photoBlob: Blob): Promise<Blob> {
    if (typeof document === 'undefined') {
      return photoBlob;
    }

    const rasterImage = await this.loadRasterImage(photoBlob);

    try {
      const width = rasterImage instanceof ImageBitmap ? rasterImage.width : rasterImage.naturalWidth;
      const height = rasterImage instanceof ImageBitmap ? rasterImage.height : rasterImage.naturalHeight;
      const scaleFactor = this.getRecognitionScaleFactor(width, height);

      if (scaleFactor === 1) {
        return photoBlob;
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scaleFactor));
      canvas.height = Math.max(1, Math.round(height * scaleFactor));

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Unable to prepare the selected image for OCR.');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(rasterImage, 0, 0, canvas.width, canvas.height);

      return this.canvasToBlob(canvas);
    } finally {
      this.releaseRasterImage(rasterImage);
    }
  }

  private getRecognitionScaleFactor(width: number, height: number): number {
    const longestSide = Math.max(width, height);

    if (longestSide <= 0) {
      return 1;
    }

    const targetScaleFactor = this.minimumRecognitionDimension / longestSide;
    return Math.max(1, Math.min(this.maximumUpscaleFactor, targetScaleFactor));
  }

  private async loadRasterImage(sourceBlob: Blob): Promise<LoadedRasterImage> {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(sourceBlob);
    }

    return new Promise<LoadedRasterImage>((resolve, reject) => {
      const image = new Image();
      const imageUrl = URL.createObjectURL(sourceBlob);
      image.onload = () => {
        URL.revokeObjectURL(imageUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error('Unable to load the selected image for OCR.'));
      };
      image.src = imageUrl;
    });
  }

  private releaseRasterImage(rasterImage: LoadedRasterImage): void {
    if (rasterImage instanceof ImageBitmap) {
      rasterImage.close();
    }
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Unable to prepare the selected image for OCR.'));
      }, 'image/png');
    });
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
      .map((line) => this.normalizeCommonUnitMisreads(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return normalizedText.length > 0 ? normalizedText : null;
  }

  private normalizeCommonUnitMisreads(line: string): string {
    return line
      .replace(/\b([A-Z]{3,})\s*[~_=.:,-]+\s*(?=\d)/g, '$1 ')
      .replace(/\b([A-Z]{3,})\s{2,}(?=\d)/g, '$1 ')
      .replace(/(?<=\d)K6\b/g, 'KG')
      .replace(/(?<=\d)(?:L8|18)\b/g, 'LB');
  }
}
