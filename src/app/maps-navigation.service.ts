import { Injectable } from '@angular/core';

export interface MapCoordinates {
  latitude: number;
  longitude: number;
}

@Injectable({ providedIn: 'root' })
export class MapsNavigationService {
  openDirections(destination: MapCoordinates, origin?: MapCoordinates): string {
    const directionsUrl = this.buildDirectionsUrl(destination, origin);

    if (typeof window !== 'undefined') {
      window.location.assign(directionsUrl);
    }

    return directionsUrl;
  }

  private buildDirectionsUrl(destination: MapCoordinates, origin?: MapCoordinates): string {
    const destinationValue = this.formatCoordinates(destination);

    if (this.isApplePlatform()) {
      const queryParameters = new URLSearchParams({
        daddr: destinationValue,
        dirflg: 'd',
      });

      if (origin) {
        queryParameters.set('saddr', this.formatCoordinates(origin));
      }

      return `https://maps.apple.com/?${queryParameters.toString()}`;
    }

    const queryParameters = new URLSearchParams({
      api: '1',
      destination: destinationValue,
      travelmode: 'driving',
    });

    if (origin) {
      queryParameters.set('origin', this.formatCoordinates(origin));
    }

    return `https://www.google.com/maps/dir/?${queryParameters.toString()}`;
  }

  private isApplePlatform(): boolean {
    if (typeof navigator === 'undefined') {
      return false;
    }

    const userAgent = navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod|macintosh/.test(userAgent);
  }

  private formatCoordinates(coordinates: MapCoordinates): string {
    return `${coordinates.latitude},${coordinates.longitude}`;
  }
}
