import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { AzureDocumentIntelligenceService } from './azure-document-intelligence.service';
import { GeolocationService } from './geolocation.service';
import { MapsNavigationService } from './maps-navigation.service';
import { NetworkStatusService } from './network-status.service';
import { PhotoOcrService } from './photo-ocr.service';
import { PhotoStorageService } from './photo-storage.service';

describe('App', () => {
  const isOnline = signal(true);
  const geolocationStatus = signal<'on' | 'off' | 'unsupported'>('off');
  const geolocationDetails = signal('GPS is unavailable in tests.');
  const latestCoordinates = signal<{ latitude: number; longitude: number; accuracy: number } | null>(null);

  beforeEach(async () => {
    isOnline.set(true);

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: NetworkStatusService,
          useValue: {
            isOnline: isOnline.asReadonly(),
          },
        },
        {
          provide: GeolocationService,
          useValue: {
            status: geolocationStatus.asReadonly(),
            details: geolocationDetails.asReadonly(),
            latestCoordinates: latestCoordinates.asReadonly(),
            refresh: async () => undefined,
            captureSnapshot: async () => null,
          },
        },
        {
          provide: MapsNavigationService,
          useValue: {
            openDirections: () => undefined,
          },
        },
        {
          provide: PhotoOcrService,
          useValue: {
            extractText: async () => ({ text: null, confidence: null }),
          },
        },
        {
          provide: AzureDocumentIntelligenceService,
          useValue: {
            extractText: async (_blob: Blob, _apiKey: string) => ({ text: null, confidence: null }),
          },
        },
        {
          provide: PhotoStorageService,
          useValue: {
            resetProcessingPhotosToPending: async () => undefined,
            loadPhotos: async () => [],
            savePhoto: async () => 'test-photo',
            loadPhotoOcrJob: async () => null,
            markPhotoOcrProcessing: async () => undefined,
            completePhotoOcr: async () => undefined,
            failPhotoOcr: async () => undefined,
            deletePhoto: async () => undefined,
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the page title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Offline Photo Log');
  });

  it('shows both OCR providers while online', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Tesseract.js');
    expect(compiled.textContent).toContain('Azure Document Intelligence');
  });

  it('requires a manually entered Azure key before enabling Azure OCR', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const azureKeyInput = compiled.querySelector('#azure-api-key') as HTMLInputElement | null;
    const azureRadio = compiled.querySelector('input[value="azure-document-intelligence"]') as HTMLInputElement | null;

    expect(azureKeyInput).not.toBeNull();
    expect(azureRadio?.disabled).toBe(true);

    if (!azureKeyInput) {
      return;
    }

    azureKeyInput.value = 'manual-test-key';
    azureKeyInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const refreshedAzureRadio = compiled.querySelector('input[value="azure-document-intelligence"]') as HTMLInputElement | null;
    expect(refreshedAzureRadio?.disabled).toBe(false);
  });

  it('limits OCR to tesseract while offline', async () => {
    isOnline.set(false);

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('The device is offline');
    expect(compiled.textContent).not.toContain('Uses the online Read model from your Azure resource.');
  });
});
