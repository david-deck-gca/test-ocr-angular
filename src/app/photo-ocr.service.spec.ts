import { TestBed } from '@angular/core/testing';

import { PhotoOcrService } from './photo-ocr.service';

describe('PhotoOcrService', () => {
  it('should create the service', () => {
    TestBed.configureTestingModule({});

    const service = TestBed.inject(PhotoOcrService);

    expect(service).toBeTruthy();
  });
});
