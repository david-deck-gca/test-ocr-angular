export type PhotoOcrProvider = 'tesseract' | 'azure-document-intelligence';

export const DEFAULT_PHOTO_OCR_PROVIDER: PhotoOcrProvider = 'tesseract';

export function getPhotoOcrProviderLabel(provider: PhotoOcrProvider): string {
  return provider === 'azure-document-intelligence' ? 'Azure Document Intelligence' : 'Tesseract.js';
}
