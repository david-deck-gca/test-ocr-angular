export function normalizeOcrText(rawText: string): string | null {
  const normalizedText = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .map((line) => normalizeCommonUnitMisreads(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalizedText.length > 0 ? normalizedText : null;
}

function normalizeCommonUnitMisreads(line: string): string {
  return line
    .replace(/\b([A-Z]{3,})\s*[~_=.:,-]+\s*(?=\d)/g, '$1 ')
    .replace(/\b([A-Z]{3,})\s{2,}(?=\d)/g, '$1 ')
    .replace(/(?<=\d)K6\b/g, 'KG')
    .replace(/(?<=\d)(?:L8|18)\b/g, 'LB');
}
