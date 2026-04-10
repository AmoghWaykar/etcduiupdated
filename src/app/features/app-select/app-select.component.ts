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

  /** Set of relativePaths the user has checked for copying */
  selectedKeys = signal<Set<string>>(new Set());

  loadingSource = signal(false);
  copying = signal(false);

  /** All non-secure keys available to select */
  readonly selectableKeys = computed(() =>
    this.copySourceKeys().filter(k => !k.isSecure)
  );

  /** Count of currently selected keys */
  readonly selectedCount = computed(() => this.selectedKeys().size);

  /** True if every selectable key is checked */
  readonly allSelected = computed(() =>
    this.selectableKeys().length > 0 &&
    this.selectableKeys().every(k => this.selectedKeys().has(k.relativePath))
  );

  /** True if some (but not all) selectable keys are checked */
  readonly someSelected = computed(() =>
    this.selectedCount() > 0 && !this.allSelected()
  );

  /** True once source keys have been fetched */
  readonly sourceLoaded = computed(() => this.copySourceKeys().length > 0);

  openCopyPanel(): void {
    this.copySourceApp.set(this.draft.trim() || this.appState.appName());
    this.copyDestApp.set('');
    this.copySourceKeys.set([]);
    this.selectedKeys.set(new Set());
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
    this.selectedKeys.set(new Set());
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
          // Auto-select all non-secure keys by default
          const autoSelected = new Set(flat.filter(k => !k.isSecure).map(k => k.relativePath));
          this.selectedKeys.set(autoSelected);

          if (!flat.length) {
            this.snack.open(`No keys found under "${src}".`, 'Dismiss', { duration: 4000 });
          } else {
            this.snack.open(
              `Found ${flat.length} key(s) — ${autoSelected.size} selected for copy.`,
              'OK',
              { duration: 3000 }
            );
          }
        },
        error: (e: Error) => this.snack.open(e.message, 'Dismiss', { duration: 8000 }),
      });
  }

  isKeySelected(relativePath: string): boolean {
    return this.selectedKeys().has(relativePath);
  }

  toggleKey(relativePath: string): void {
    const current = new Set(this.selectedKeys());
    if (current.has(relativePath)) {
      current.delete(relativePath);
    } else {
      current.add(relativePath);
    }
    this.selectedKeys.set(current);
  }

  toggleAll(): void {
    if (this.allSelected()) {
      // Deselect all
      this.selectedKeys.set(new Set());
    } else {
      // Select all non-secure
      const all = new Set(this.selectableKeys().map(k => k.relativePath));
      this.selectedKeys.set(all);
    }
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

    // Only copy the user-selected keys
    const keys = this.copySourceKeys().filter(
      k => !k.isSecure && this.selectedKeys().has(k.relativePath)
    );
    if (!keys.length) {
      this.snack.open('No keys selected for copying.', 'Dismiss', { duration: 4000 });
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