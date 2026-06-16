import { Injectable, signal } from '@angular/core';

import { PhotoCoordinates } from './photo-storage.service';

export type GpsStatus = 'checking' | 'on' | 'off' | 'unsupported';

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  private readonly statusState = signal<GpsStatus>(this.isGeolocationSupported() ? 'checking' : 'unsupported');
  private readonly coordinatesState = signal<PhotoCoordinates | null>(null);
  private readonly detailsState = signal('Waiting for GPS access.');

  private watchId: number | null = null;

  readonly status = this.statusState.asReadonly();
  readonly latestCoordinates = this.coordinatesState.asReadonly();
  readonly details = this.detailsState.asReadonly();

  constructor() {
    void this.initialize();
  }

  async refresh(): Promise<void> {
    await this.captureSnapshot({ updateSignals: true });
  }

  async captureSnapshot(options: { updateSignals: boolean }): Promise<PhotoCoordinates | null> {
    if (!this.isGeolocationSupported()) {
      this.statusState.set('unsupported');
      this.detailsState.set('GPS is not available in this browser.');
      return null;
    }

    if (options.updateSignals) {
      this.statusState.set('checking');
      this.detailsState.set('Checking GPS status…');
    }

    return new Promise<PhotoCoordinates | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coordinates = this.mapCoordinates(position);

          if (options.updateSignals) {
            this.coordinatesState.set(coordinates);
            this.statusState.set('on');
            this.detailsState.set('GPS is on and a position is available.');
          }

          resolve(coordinates);
        },
        (error) => {
          if (options.updateSignals) {
            this.handlePositionError(error);
          }

          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 15000,
        },
      );
    });
  }

  private async initialize(): Promise<void> {
    if (!this.isGeolocationSupported()) {
      this.statusState.set('unsupported');
      this.detailsState.set('GPS is not available in this browser.');
      return;
    }

    await this.observePermissions();
    this.startWatchingPosition();
    await this.refresh();
  }

  private async observePermissions(): Promise<void> {
    if (!('permissions' in navigator) || typeof navigator.permissions.query !== 'function') {
      return;
    }

    const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });

    this.applyPermissionState(permissionStatus.state);
    permissionStatus.addEventListener('change', () => {
      this.applyPermissionState(permissionStatus.state);
      void this.refresh();
    });
  }

  private applyPermissionState(state: PermissionState): void {
    if (state === 'denied') {
      this.statusState.set('off');
      this.detailsState.set('GPS is off or blocked by the browser permission.');
      return;
    }

    if (state === 'prompt' && !this.coordinatesState()) {
      this.statusState.set('checking');
      this.detailsState.set('Allow location access to detect whether GPS is on.');
    }
  }

  private startWatchingPosition(): void {
    if (this.watchId !== null || !this.isGeolocationSupported()) {
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coordinates = this.mapCoordinates(position);
        this.coordinatesState.set(coordinates);
        this.statusState.set('on');
        this.detailsState.set('GPS is on and updating your current position.');
      },
      (error) => {
        this.handlePositionError(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 15000,
      },
    );
  }

  private handlePositionError(error: GeolocationPositionError): void {
    if (error.code === error.PERMISSION_DENIED) {
      this.statusState.set('off');
      this.detailsState.set('GPS is off or blocked by the browser permission.');
      return;
    }

    if (error.code === error.TIMEOUT) {
      this.statusState.set('off');
      this.detailsState.set('GPS did not respond in time.');
      return;
    }

    this.statusState.set('off');
    this.detailsState.set('GPS is unavailable right now.');
  }

  private isGeolocationSupported(): boolean {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  }

  private mapCoordinates(position: GeolocationPosition): PhotoCoordinates {
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      capturedAt: new Date(position.timestamp).toISOString(),
    };
  }
}
