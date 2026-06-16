import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  private readonly isOnlineState = signal(this.getInitialState());

  readonly isOnline = this.isOnlineState.asReadonly();

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }

    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  private getInitialState(): boolean {
    if (typeof navigator === 'undefined') {
      return true;
    }

    return navigator.onLine;
  }

  private readonly handleOnline = () => {
    this.isOnlineState.set(true);
  };

  private readonly handleOffline = () => {
    this.isOnlineState.set(false);
  };
}
