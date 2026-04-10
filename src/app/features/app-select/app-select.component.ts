import { Component, inject, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { finalize } from 'rxjs/operators';
import { AppStateService } from '../../core/services/app-state.service';
import {
  EtcdApiService,
  buildFullKey,
  isValidAppName,
  normalizeAppName,
} from '../../core/services/etcd-api.service';
import { AppKeyEntry } from '../../core/models/etcd.models';

@Component({
  selector: 'app-app-select',
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSnackBarModule,
    MatChipsModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  templateUrl: './app-select.component.html',
  styleUrl: './app-select.component.scss',
})
export class AppSelectComponent {
  readonly appState = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly etcd = inject(EtcdApiService);

  draft = normalizeAppName(this.appState.appName());

  // ── Copy Keys feature ──────────────────────────────────────────────
  copyPanelOpen = signal(false);
  copySourceApp = signal('');
  copyDestApp = signal('');
  copySourceKeys = signal<AppKeyEntry[]>([]);
  loadingSource = signal(false);
  copying = signal(false);

  /** Non-secure key count in the loaded source */
  readonly copyKeyCount = computed(() =>
    this.copySourceKeys().filter(k => !k.isSecure).length
  );

  /** True once source keys have been fetched */
  readonly sourceLoaded = computed(() => this.copySourceKeys().length > 0);

  openCopyPanel(): void {
    this.copySourceApp.set(this.draft.trim() || this.appState.appName());
    this.copyDestApp.set('');
    this.copySourceKeys.set([]);
    this.copyPanelOpen.set(true);
  }

  closeCopyPanel(): void {
    this.copyPanelOpen.set(false);
  }

  loadSourceKeys(): void {
    const src = normalizeAppName(this.copySourceApp());
    if (!src || !isValidAppName(src)) {
      this.snack.open('Enter a valid source application name.', 'Dismiss', { duration: 4000 });
      return;
    }
    this.loadingSource.set(true);
    this.copySourceKeys.set([]);
    this.etcd
      .rangeByAppPrefix(src)
      .pipe(finalize(() => this.loadingSource.set(false)))
      .subscribe({
        next: (kvs) => {
          const prefix = `${src}/`;
          const flat: AppKeyEntry[] = [];
          for (const kv of kvs) {
            const decoded = this.etcd.decodeKv(kv);
            if (!decoded.key.startsWith(prefix)) continue;
            const relativePath = decoded.key.slice(prefix.length);
            if (!relativePath) continue;
            flat.push({
              relativePath,
              value: decoded.value,
              isSecure: relativePath.startsWith('secure/'),
              modRevision: kv.mod_revision ?? '',
              version: kv.version ?? '',
              createRevision: kv.create_revision ?? '',
            });
          }
          this.copySourceKeys.set(flat);
          if (!flat.length) {
            this.snack.open(`No keys found under "${src}".`, 'Dismiss', { duration: 4000 });
          } else {
            this.snack.open(
              `Found ${flat.length} key(s) under "${src}" (${this.copyKeyCount()} non-secure).`,
              'OK',
              { duration: 3000 }
            );
          }
        },
        error: (e: Error) => this.snack.open(e.message, 'Dismiss', { duration: 8000 }),
      });
  }

  executeCopy(): void {
    const src = normalizeAppName(this.copySourceApp());
    const dest = normalizeAppName(this.copyDestApp());

    if (!dest || !isValidAppName(dest)) {
      this.snack.open('Enter a valid destination application name.', 'Dismiss', { duration: 4000 });
      return;
    }
    if (src === dest) {
      this.snack.open('Source and destination must be different.', 'Dismiss', { duration: 4000 });
      return;
    }
    const keys = this.copySourceKeys().filter(k => !k.isSecure);
    if (!keys.length) {
      this.snack.open('No non-secure keys to copy.', 'Dismiss', { duration: 4000 });
      return;
    }

    this.copying.set(true);
    let count = 0;
    const doNext = (idx: number): void => {
      if (idx >= keys.length) {
        this.copying.set(false);
        this.snack.open(`Copied ${count} key(s) from "${src}" → "${dest}".`, 'OK', { duration: 4000 });
        this.appState.setAppName(dest);
        void this.router.navigate(['/explorer']);
        return;
      }
      const entry = keys[idx];
      const fullDest = buildFullKey(dest, entry.relativePath);
      this.etcd.putKey(fullDest, entry.value).subscribe({
        next: () => { count++; doNext(idx + 1); },
        error: (e: Error) => {
          this.copying.set(false);
          this.snack.open(`Copy failed at "${entry.relativePath}": ${e.message}`, 'Dismiss', { duration: 8000 });
        },
      });
    };
    doNext(0);
  }

  // ── Namespace select ───────────────────────────────────────────────
  pickRecent(name: string): void {
    this.draft = name;
  }

  continue(): void {
    const name = normalizeAppName(this.draft);
    if (!name) {
      this.snack.open('Enter an application name.', 'Dismiss', { duration: 4000 });
      return;
    }
    if (!isValidAppName(name)) {
      this.snack.open(
        'Use letters, numbers, dot, underscore, or hyphen. Must start with alphanumeric.',
        'Dismiss',
        { duration: 6000 },
      );
      return;
    }
    this.appState.setAppName(name);
    void this.router.navigate(['/explorer']);
  }
}