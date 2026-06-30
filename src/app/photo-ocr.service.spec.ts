import { TestBed } from '@angular/core/testing';

import { PhotoOcrService } from './photo-ocr.service';
import { normalizeOcrText } from './ocr-text-normalizer';

describe('PhotoOcrService', () => {
  it('should create the service', () => {
    TestBed.configureTestingModule({});

    const service = TestBed.inject(PhotoOcrService);

    expect(service).toBeTruthy();
  });

  it('normalizes common OCR unit suffix misreads', () => {
    expect(normalizeOcrText('MPGM  36000K6\n7936518\n\nTARE ~~ 3650K6\n8047L8')).toBe(
      'MPGM 36000KG\n79365LB\n\nTARE 3650KG\n8047LB',
    );
  });
});
