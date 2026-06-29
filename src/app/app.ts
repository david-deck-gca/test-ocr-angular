import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';

import { GeolocationService } from './geolocation.service';
import { MapsNavigationService } from './maps-navigation.service';
import { CropSelection, PhotoCropDialogComponent } from './photo-crop-dialog';
import { NetworkStatusService } from './network-status.service';
import { PhotoOcrService } from './photo-ocr.service';
import { PendingPhotoOcrJob, PhotoStorageService, SavedPhoto } from './photo-storage.service';

interface CropDialogPhoto extends PendingPhotoOcrJob {
  previewUrl: string;
}

type LoadedRasterImage = HTMLImageElement | ImageBitmap;

@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe, PhotoCropDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly networkStatusService = inject(NetworkStatusService);
  private readonly geolocationService = inject(GeolocationService);
  private readonly mapsNavigationService = inject(MapsNavigationService);
  private readonly photoOcrService = inject(PhotoOcrService);
  private readonly photoStorageService = inject(PhotoStorageService);

  protected readonly photos = signal<SavedPhoto[]>([]);
  protected readonly isSaving = signal(false);
  protected readonly navigatingPhotoId = signal<string | null>(null);
  protected readonly feedbackMessage = signal<string | null>(null);
  protected readonly cropDialogPhoto = signal<CropDialogPhoto | null>(null);

  protected readonly isOnline = this.networkStatusService.isOnline;
  protected readonly gpsStatus = this.geolocationService.status;
  protected readonly gpsDetails = this.geolocationService.details;
  protected readonly latestCoordinates = this.geolocationService.latestCoordinates;
  protected readonly showMobileCaptureOptions = this.shouldShowMobileCaptureOptions();

  protected readonly pageTitle = 'Offline Photo Log';
  protected readonly onlineMessage = computed(() =>
    this.isOnline()
      ? 'Online: the app is connected.'
      : 'Offline: you can still take photos and save them locally.',
  );
  protected readonly storageSummary = computed(() => {
    const photoCount = this.photos().length;
    return `${photoCount} photo${photoCount === 1 ? '' : 's'} stored in IndexedDB.`;
  });

  constructor() {
    void this.initialize();
  }

  protected async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files?.item(0);

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.feedbackMessage.set('Please choose an image file.');
      input.value = '';
      return;
    }

    this.isSaving.set(true);
    this.feedbackMessage.set('Saving photo…');

    try {
      const coordinates = await this.geolocationService.captureSnapshot({ updateSignals: false });
      const photoId = await this.photoStorageService.savePhoto(file, coordinates);
      await this.refreshPhotos();
      this.openCropDialogForSavedPhotoId(photoId, file);
      this.feedbackMessage.set(
        coordinates
          ? 'Photo saved in IndexedDB with the latest GPS coordinates. Select the text area to start OCR.'
          : 'Photo saved in IndexedDB without GPS coordinates. Select the text area to start OCR.',
      );
    } finally {
      this.isSaving.set(false);
      input.value = '';
    }
  }

  protected async refreshGpsStatus(): Promise<void> {
    await this.geolocationService.refresh();
  }

  protected async deletePhoto(id: string): Promise<void> {
    await this.photoStorageService.deletePhoto(id);

    if (this.cropDialogPhoto()?.id === id) {
      this.cropDialogPhoto.set(null);
    }

    await this.refreshPhotos();
    this.feedbackMessage.set('Photo deleted.');
  }

  protected async openTextCropDialog(photo: SavedPhoto): Promise<void> {
    const ocrJob = await this.photoStorageService.loadPhotoOcrJob(photo.id);

    if (!ocrJob) {
      this.feedbackMessage.set('Unable to load this photo for OCR.');
      return;
    }

    this.cropDialogPhoto.set({
      ...ocrJob,
      previewUrl: photo.previewUrl,
    });

    this.feedbackMessage.set(
      photo.ocrStatus === 'failed'
        ? 'Select a new text area and retry OCR.'
        : 'Select the text area to analyze offline.',
    );
  }

  protected cancelCropDialog(): void {
    this.cropDialogPhoto.set(null);
  }

  protected async confirmCrop(selection: CropSelection | null): Promise<void> {
    const cropDialogPhoto = this.cropDialogPhoto();

    if (!cropDialogPhoto) {
      return;
    }

    this.cropDialogPhoto.set(null);
    await this.photoStorageService.markPhotoOcrProcessing(cropDialogPhoto.id);
    await this.refreshPhotos();
    this.feedbackMessage.set('Extracting English text offline…');

    try {
      const ocrBlob = selection
        ? await this.createCroppedBlob(cropDialogPhoto.blob, selection)
        : cropDialogPhoto.blob;
      const extractedText = await this.photoOcrService.extractText(ocrBlob);

      await this.photoStorageService.completePhotoOcr(cropDialogPhoto.id, extractedText);
      this.feedbackMessage.set(
        extractedText.text
          ? 'Offline text extraction finished and was stored with the photo.'
          : 'Offline text extraction finished. No readable English text was detected.',
      );
    } catch {
      await this.photoStorageService.failPhotoOcr(cropDialogPhoto.id);
      this.feedbackMessage.set('Offline text extraction failed for this photo.');
    } finally {
      await this.refreshPhotos();
    }
  }

  protected async openDirectionsToPhoto(photo: SavedPhoto): Promise<void> {
    if (photo.latitude === null || photo.longitude === null) {
      this.feedbackMessage.set('This photo does not have a saved location.');
      return;
    }

    this.navigatingPhotoId.set(photo.id);
    this.feedbackMessage.set('Opening directions…');

    try {
      const currentCoordinates = await this.geolocationService.captureSnapshot({ updateSignals: true });

      this.mapsNavigationService.openDirections(
        {
          latitude: photo.latitude,
          longitude: photo.longitude,
        },
        currentCoordinates
          ? {
              latitude: currentCoordinates.latitude,
              longitude: currentCoordinates.longitude,
            }
          : undefined,
      );

      this.feedbackMessage.set(
        currentCoordinates
          ? 'Opening directions in your maps app.'
          : 'Opening the destination in your maps app. Allow location access to start from your current position.',
      );
    } finally {
      this.navigatingPhotoId.set(null);
    }
  }

  private async initialize(): Promise<void> {
    await this.photoStorageService.resetProcessingPhotosToPending();
    await this.refreshPhotos();
  }

  private shouldShowMobileCaptureOptions(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }

    const supportsCoarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

    return supportsCoarsePointer || navigator.maxTouchPoints > 0;
  }

  private openCropDialogForSavedPhotoId(photoId: string, blob: Blob): void {
    const savedPhoto = this.photos().find((photo) => photo.id === photoId);

    if (!savedPhoto) {
      return;
    }

    this.cropDialogPhoto.set({
      id: photoId,
      blob,
      previewUrl: savedPhoto.previewUrl,
    });
  }

  private async createCroppedBlob(sourceBlob: Blob, selection: CropSelection): Promise<Blob> {
    const rasterImage = await this.loadRasterImage(sourceBlob);

    try {
      const width = rasterImage instanceof ImageBitmap ? rasterImage.width : rasterImage.naturalWidth;
      const height = rasterImage instanceof ImageBitmap ? rasterImage.height : rasterImage.naturalHeight;
      const cropLeft = Math.round(selection.left * width);
      const cropTop = Math.round(selection.top * height);
      const cropWidth = Math.max(1, Math.round(selection.width * width));
      const cropHeight = Math.max(1, Math.round(selection.height * height));
      const canvas = document.createElement('canvas');
      canvas.width = cropWidth;
      canvas.height = cropHeight;

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Unable to crop the selected image area.');
      }

      context.drawImage(rasterImage, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

      return await this.canvasToBlob(canvas, 'image/png');
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
        reject(new Error('Unable to load the selected image for cropping.'));
      };
      image.src = imageUrl;
    });
  }

  private releaseRasterImage(rasterImage: LoadedRasterImage): void {
    if (rasterImage instanceof ImageBitmap) {
      rasterImage.close();
    }
  }

  private canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Unable to create the cropped image blob.'));
      }, mimeType, 0.92);
    });
  }

  private async refreshPhotos(): Promise<void> {
    this.photos.set(await this.photoStorageService.loadPhotos());
  }
}
