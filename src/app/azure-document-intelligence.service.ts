import { Injectable } from '@angular/core';

import { normalizeOcrText } from './ocr-text-normalizer';
import { type PhotoOcrExtraction } from './photo-ocr.service';

type LoadedRasterImage = HTMLImageElement | ImageBitmap;

interface AzureAnalyzeWord {
  confidence?: number;
}

interface AzureAnalyzePage {
  words?: AzureAnalyzeWord[];
}

interface AzureAnalyzeResult {
  content?: string;
  pages?: AzureAnalyzePage[];
}

interface AzureAnalyzeOperation {
  status?: string;
  analyzeResult?: AzureAnalyzeResult;
  error?: {
    message?: string;
  };
}

@Injectable({ providedIn: 'root' })
export class AzureDocumentIntelligenceService {
  private readonly endpoint = 'https://lesturepdf.cognitiveservices.azure.com/';
  private readonly apiVersion = '2024-11-30';
  private readonly maximumInputBytes = 4_000_000;
  private readonly maximumImageDimension = 2_500;
  private readonly pollDelayMs = 1_000;
  private readonly maximumPollAttempts = 30;

  async extractText(photoBlob: Blob, apiKey: string): Promise<PhotoOcrExtraction> {
    const normalizedApiKey = apiKey.trim();

    if (normalizedApiKey.length === 0) {
      throw new Error('Enter an Azure Document Intelligence key before using Azure OCR.');
    }

    const requestBlob = await this.prepareRecognitionInput(photoBlob);
    const operationLocation = await this.startAnalysis(requestBlob, normalizedApiKey);
    const result = await this.pollForAnalysisResult(operationLocation, normalizedApiKey);

    return {
      text: normalizeOcrText(result.analyzeResult?.content ?? ''),
      confidence: this.getAverageConfidence(result.analyzeResult),
    };
  }

  private async startAnalysis(photoBlob: Blob, apiKey: string): Promise<string> {
    const response = await fetch(this.buildAnalyzeUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': photoBlob.type || 'application/octet-stream',
        'Ocp-Apim-Subscription-Key': apiKey,
      },
      body: photoBlob,
    });

    if (!response.ok) {
      throw await this.createAzureError(response);
    }

    const operationLocation = response.headers.get('operation-location');

    if (!operationLocation) {
      throw new Error('Azure Document Intelligence did not return an operation URL.');
    }

    return operationLocation;
  }

  private async pollForAnalysisResult(operationLocation: string, apiKey: string): Promise<AzureAnalyzeOperation> {
    for (let attempt = 0; attempt < this.maximumPollAttempts; attempt += 1) {
      const response = await fetch(operationLocation, {
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
        },
      });

      if (!response.ok) {
        throw await this.createAzureError(response);
      }

      const result = (await response.json()) as AzureAnalyzeOperation;
      const status = result.status?.toLowerCase();

      if (status === 'succeeded') {
        return result;
      }

      if (status === 'failed') {
        throw new Error(result.error?.message ?? 'Azure Document Intelligence could not analyze the image.');
      }

      await this.delay(this.pollDelayMs);
    }

    throw new Error('Azure Document Intelligence timed out before finishing OCR.');
  }

  private getAverageConfidence(result: AzureAnalyzeResult | undefined): number | null {
    const wordConfidences = (result?.pages ?? [])
      .flatMap((page) => page.words ?? [])
      .map((word) => word.confidence)
      .filter((confidence): confidence is number => typeof confidence === 'number' && Number.isFinite(confidence));

    if (wordConfidences.length === 0) {
      return null;
    }

    const totalConfidence = wordConfidences.reduce((sum, confidence) => sum + confidence, 0);
    return (totalConfidence / wordConfidences.length) * 100;
  }

  private buildAnalyzeUrl(): string {
    return `${this.endpoint}documentintelligence/documentModels/prebuilt-read:analyze?api-version=${this.apiVersion}`;
  }

  private async createAzureError(response: Response): Promise<Error> {
    const fallbackMessage = `Azure Document Intelligence request failed with status ${response.status}.`;
    const responseBody = await this.readResponseBody(response);

    if (!responseBody) {
      return new Error(fallbackMessage);
    }

    if (typeof responseBody === 'string') {
      return new Error(responseBody);
    }

    const message = this.extractResponseMessage(responseBody);
    return new Error(message ?? fallbackMessage);
  }

  private async readResponseBody(response: Response): Promise<unknown> {
    const responseText = await response.text();

    if (responseText.length === 0) {
      return null;
    }

    try {
      return JSON.parse(responseText) as unknown;
    } catch {
      return responseText;
    }
  }

  private extractResponseMessage(responseBody: unknown): string | null {
    if (!responseBody || typeof responseBody !== 'object') {
      return null;
    }

    const message = 'message' in responseBody ? responseBody.message : null;

    if (typeof message === 'string' && message.length > 0) {
      return message;
    }

    const error = 'error' in responseBody ? responseBody.error : null;

    if (!error || typeof error !== 'object') {
      return null;
    }

    const nestedMessage = 'message' in error ? error.message : null;
    return typeof nestedMessage === 'string' && nestedMessage.length > 0 ? nestedMessage : null;
  }

  private delay(durationMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, durationMs);
    });
  }

  private async prepareRecognitionInput(photoBlob: Blob): Promise<Blob> {
    if (typeof document === 'undefined') {
      return photoBlob;
    }

    if (photoBlob.size <= this.maximumInputBytes) {
      const dimensions = await this.getImageDimensions(photoBlob);

      if (Math.max(dimensions.width, dimensions.height) <= this.maximumImageDimension) {
        return photoBlob;
      }
    }

    const rasterImage = await this.loadRasterImage(photoBlob);

    try {
      const width = rasterImage instanceof ImageBitmap ? rasterImage.width : rasterImage.naturalWidth;
      const height = rasterImage instanceof ImageBitmap ? rasterImage.height : rasterImage.naturalHeight;
      const longestSide = Math.max(width, height);
      const scaleFactor = longestSide > this.maximumImageDimension ? this.maximumImageDimension / longestSide : 1;
      const targetWidth = Math.max(1, Math.round(width * scaleFactor));
      const targetHeight = Math.max(1, Math.round(height * scaleFactor));
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Unable to prepare the selected image for Azure OCR.');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, targetWidth, targetHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(rasterImage, 0, 0, targetWidth, targetHeight);

      for (const quality of [0.82, 0.68, 0.5]) {
        const compressedBlob = await this.canvasToBlob(canvas, 'image/jpeg', quality);

        if (compressedBlob.size <= this.maximumInputBytes || quality === 0.5) {
          return compressedBlob;
        }
      }

      return photoBlob;
    } finally {
      this.releaseRasterImage(rasterImage);
    }
  }

  private async getImageDimensions(sourceBlob: Blob): Promise<{ width: number; height: number }> {
    const rasterImage = await this.loadRasterImage(sourceBlob);

    try {
      return rasterImage instanceof ImageBitmap
        ? { width: rasterImage.width, height: rasterImage.height }
        : { width: rasterImage.naturalWidth, height: rasterImage.naturalHeight };
    } finally {
      this.releaseRasterImage(rasterImage);
    }
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
        reject(new Error('Unable to load the selected image for Azure OCR.'));
      };
      image.src = imageUrl;
    });
  }

  private releaseRasterImage(rasterImage: LoadedRasterImage): void {
    if (rasterImage instanceof ImageBitmap) {
      rasterImage.close();
    }
  }

  private canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Unable to prepare the selected image for Azure OCR.'));
      }, mimeType, quality);
    });
  }
}
