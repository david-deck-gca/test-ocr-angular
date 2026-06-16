import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';

import { GeolocationService } from './geolocation.service';
import { MapsNavigationService } from './maps-navigation.service';
import { NetworkStatusService } from './network-status.service';
import { PhotoStorageService, SavedPhoto } from './photo-storage.service';

@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly networkStatusService = inject(NetworkStatusService);
  private readonly geolocationService = inject(GeolocationService);
  private readonly mapsNavigationService = inject(MapsNavigationService);
  private readonly photoStorageService = inject(PhotoStorageService);

  protected readonly photos = signal<SavedPhoto[]>([]);
  protected readonly isSaving = signal(false);
  protected readonly navigatingPhotoId = signal<string | null>(null);
  protected readonly feedbackMessage = signal<string | null>(null);

  protected readonly isOnline = this.networkStatusService.isOnline;
  protected readonly gpsStatus = this.geolocationService.status;
  protected readonly gpsDetails = this.geolocationService.details;
  protected readonly latestCoordinates = this.geolocationService.latestCoordinates;

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
    void this.refreshPhotos();
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
      await this.photoStorageService.savePhoto(file, coordinates);
      await this.refreshPhotos();
      this.feedbackMessage.set(
        coordinates
          ? 'Photo saved in IndexedDB with the latest GPS coordinates.'
          : 'Photo saved in IndexedDB without GPS coordinates.',
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
    await this.refreshPhotos();
    this.feedbackMessage.set('Photo deleted.');
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

  private async refreshPhotos(): Promise<void> {
    this.photos.set(await this.photoStorageService.loadPhotos());
  }
}
