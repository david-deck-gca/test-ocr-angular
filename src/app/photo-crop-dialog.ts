import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';

export interface CropSelection {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragPoint {
  x: number;
  y: number;
}

@Component({
  selector: 'app-photo-crop-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="crop-dialog-backdrop" role="presentation">
      <section class="crop-dialog card" aria-labelledby="crop-dialog-title" aria-modal="true" role="dialog">
        <div class="crop-dialog__header">
          <div>
            <p class="crop-dialog__eyebrow">Manual crop before OCR</p>
            <h2 id="crop-dialog-title">Select the text area</h2>
            <p>
              Drag over the image to choose the region to analyze offline. English OCR will run only
              on the selected area.
            </p>
          </div>

          <button type="button" class="secondary-button" (click)="cancelled.emit()">Close</button>
        </div>

        <div
          #cropSurface
          class="crop-surface"
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="onPointerUp($event)"
          (pointercancel)="onPointerUp($event)"
        >
          <img [src]="imageUrl()" alt="Photo selected for OCR cropping" draggable="false" />

          @if (selectionStyle(); as style) {
            <div
              class="crop-surface__selection"
              [style.left.%]="style.left"
              [style.top.%]="style.top"
              [style.width.%]="style.width"
              [style.height.%]="style.height"
            ></div>
          }
        </div>

        <div class="crop-dialog__footer">
          <p>
            @if (hasSelection()) {
              OCR will use only the selected crop.
            } @else {
              No crop selected yet. You can still run OCR on the full photo.
            }
          </p>

          <div class="crop-dialog__actions">
            <button type="button" class="secondary-button" [disabled]="!hasSelection()" (click)="clearSelection()">
              Clear selection
            </button>
            <button type="button" class="secondary-button" (click)="confirmCrop.emit(null)">
              Use full photo
            </button>
            <button type="button" class="primary-button" [disabled]="!hasSelection()" (click)="confirmSelection()">
              Run OCR on selection
            </button>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: `
    :host {
      inset: 0;
      position: fixed;
      z-index: 20;
    }

    .crop-dialog-backdrop {
      align-items: center;
      background: rgba(2, 6, 23, 0.82);
      display: flex;
      inset: 0;
      justify-content: center;
      padding: 1rem;
      position: fixed;
    }

    .crop-dialog {
      display: grid;
      gap: 1rem;
      max-height: calc(100dvh - 2rem);
      max-width: min(72rem, 100%);
      overflow: auto;
      padding: 1rem;
      width: 100%;
    }

    .crop-dialog__header,
    .crop-dialog__footer {
      display: grid;
      gap: 0.75rem;
    }

    .crop-dialog__eyebrow {
      color: #93c5fd;
      font-size: 0.875rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      margin: 0 0 0.35rem;
      text-transform: uppercase;
    }

    h2,
    p {
      margin: 0;
    }

    p {
      color: #cbd5e1;
      line-height: 1.5;
    }

    .crop-surface {
      background: #020617;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 1rem;
      cursor: crosshair;
      overflow: hidden;
      position: relative;
      touch-action: none;
      user-select: none;
    }

    .crop-surface img {
      display: block;
      max-height: min(65dvh, 44rem);
      object-fit: contain;
      user-select: none;
      width: 100%;
    }

    .crop-surface__selection {
      background: rgba(56, 189, 248, 0.18);
      border: 2px solid #38bdf8;
      border-radius: 0.75rem;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.45);
      position: absolute;
    }

    .crop-dialog__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      justify-content: flex-end;
    }

    .primary-button,
    .secondary-button {
      appearance: none;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      min-height: 2.75rem;
      padding: 0.75rem 1.1rem;
    }

    .primary-button {
      background: linear-gradient(135deg, #38bdf8, #6366f1);
      border: none;
      color: #eff6ff;
    }

    .secondary-button {
      background: transparent;
      border: 1px solid rgba(148, 163, 184, 0.4);
      color: #e2e8f0;
    }

    .primary-button:focus-visible,
    .secondary-button:focus-visible {
      outline: 3px solid #f8fafc;
      outline-offset: 2px;
    }

    .primary-button[disabled],
    .secondary-button[disabled] {
      cursor: not-allowed;
      opacity: 0.65;
    }

    @media (min-width: 48rem) {
      .crop-dialog {
        padding: 1.5rem;
      }

      .crop-dialog__header {
        align-items: start;
        grid-template-columns: 1fr auto;
      }

      .crop-dialog__footer {
        align-items: center;
        grid-template-columns: 1fr auto;
      }
    }
  `,
})
export class PhotoCropDialogComponent {
  private readonly cropSurface = viewChild.required<ElementRef<HTMLDivElement>>('cropSurface');
  private readonly minimumSelectionSize = 0.02;

  readonly imageUrl = input.required<string>();
  readonly cancelled = output<void>();
  readonly confirmCrop = output<CropSelection | null>();

  private readonly dragStart = signal<DragPoint | null>(null);
  private readonly selection = signal<CropSelection | null>(null);

  protected readonly hasSelection = computed(() => this.selection() !== null);
  protected readonly selectionStyle = computed(() => {
    const selection = this.selection();

    if (!selection) {
      return null;
    }

    return {
      left: selection.left * 100,
      top: selection.top * 100,
      width: selection.width * 100,
      height: selection.height * 100,
    };
  });

  protected clearSelection(): void {
    this.selection.set(null);
  }

  protected confirmSelection(): void {
    const selection = this.selection();

    if (!selection) {
      return;
    }

    this.confirmCrop.emit(selection);
  }

  protected onPointerDown(event: PointerEvent): void {
    const startPoint = this.toNormalizedPoint(event);

    if (!startPoint) {
      return;
    }

    this.dragStart.set(startPoint);
    this.selection.set({
      left: startPoint.x,
      top: startPoint.y,
      width: 0,
      height: 0,
    });
    this.cropSurface().nativeElement.setPointerCapture(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    const dragStart = this.dragStart();

    if (!dragStart) {
      return;
    }

    const currentPoint = this.toNormalizedPoint(event);

    if (!currentPoint) {
      return;
    }

    this.selection.set(this.createSelection(dragStart, currentPoint));
  }

  protected onPointerUp(event: PointerEvent): void {
    const dragStart = this.dragStart();

    if (!dragStart) {
      return;
    }

    const currentPoint = this.toNormalizedPoint(event);
    this.dragStart.set(null);

    if (this.cropSurface().nativeElement.hasPointerCapture(event.pointerId)) {
      this.cropSurface().nativeElement.releasePointerCapture(event.pointerId);
    }

    if (!currentPoint) {
      this.selection.set(null);
      return;
    }

    const selection = this.createSelection(dragStart, currentPoint);
    const isTooSmall = selection.width < this.minimumSelectionSize || selection.height < this.minimumSelectionSize;

    this.selection.set(isTooSmall ? null : selection);
  }

  private toNormalizedPoint(event: PointerEvent): DragPoint | null {
    const bounds = this.cropSurface().nativeElement.getBoundingClientRect();

    if (bounds.width === 0 || bounds.height === 0) {
      return null;
    }

    const x = this.clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const y = this.clamp((event.clientY - bounds.top) / bounds.height, 0, 1);

    return { x, y };
  }

  private createSelection(start: DragPoint, end: DragPoint): CropSelection {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x);
    const bottom = Math.max(start.y, end.y);

    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}
