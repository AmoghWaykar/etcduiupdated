import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmColor?: 'primary' | 'accent' | 'warn';
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="dialog-wrap">
      <div class="dialog-header">
        <mat-icon class="dialog-icon" [class.icon-warn]="data.confirmColor === 'warn'">
          {{ data.confirmColor === 'warn' ? 'warning' : 'help_outline' }}
        </mat-icon>
        <h2 class="dialog-title">{{ data.title }}</h2>
      </div>
      <mat-dialog-content class="dialog-content">{{ data.message }}</mat-dialog-content>
      <mat-dialog-actions class="dialog-actions" align="end">
        <button mat-stroked-button class="btn-cancel" type="button" (click)="ref.close(false)">
          Cancel
        </button>
        <button
          mat-flat-button
          type="button"
          class="btn-confirm"
          [class.btn-confirm-warn]="data.confirmColor === 'warn'"
          (click)="ref.close(true)"
        >
          {{ data.confirmLabel ?? 'OK' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .dialog-wrap {
      background: var(--app-surface);
      border-radius: 10px;
      overflow: hidden;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1.25rem 1.25rem 0;
    }

    .dialog-icon {
      font-size: 1.5rem;
      width: 1.5rem;
      height: 1.5rem;
      color: var(--app-accent-hover);

      &.icon-warn {
        color: var(--app-red);
      }
    }

    .dialog-title {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--app-fg);
    }

    .dialog-content {
      padding: 0.875rem 1.25rem !important;
      color: var(--app-muted);
      font-size: 0.9rem;
      white-space: pre-wrap;
      max-width: 420px;
    }

    .dialog-actions {
      padding: 0.75rem 1.25rem 1.25rem !important;
      gap: 0.5rem;
    }

    .btn-cancel {
      border-color: var(--app-border) !important;
      color: var(--app-fg) !important;
      border-radius: 7px !important;
    }

    .btn-confirm {
      background: var(--app-accent) !important;
      color: #fff !important;
      border-radius: 7px !important;

      &.btn-confirm-warn {
        background: var(--app-red) !important;
      }
    }
  `],
})
export class ConfirmDialogComponent {
  readonly ref = inject(MatDialogRef<ConfirmDialogComponent, boolean>);
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}
