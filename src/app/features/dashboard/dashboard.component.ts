import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { finalize, last } from 'rxjs/operators';
import { base64ToUtf8, utf8ToBase64 } from '../../core/utils/base64';
import { buildKeyTree, filterTree } from '../../core/utils/key-tree';
import { KeyTreeNode } from '../../shared/models/key-tree-node.model';
import { KeyTreeComponent } from './key-tree/key-tree.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { AppStateService } from '../../core/services/app-state.service';
import {
  buildFullKey,
  EtcdApiService,
  normalizeAppName,
} from '../../core/services/etcd-api.service';
import { AppKeyEntry } from '../../core/models/etcd.models';

export interface VersionBadge {
  /** Human-readable label shown on the badge: "v1", "v2", "v3" … */
  label: string;
  /** Raw etcd revision number used for the range API call */
  revision: string;
  /** True for the currently active version of the key */
  isCurrent: boolean;
}

@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatTabsModule,
    MatSelectModule,
    KeyTreeComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly etcd = inject(EtcdApiService);
  private readonly appState = inject(AppStateService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  readonly appName = computed(() => normalizeAppName(this.appState.appName()));

  loading = signal(false);
  saving = signal(false);
  importing = signal(false);
  readonly search = signal('');

  readonly flatKeys = signal<AppKeyEntry[]>([]);
  private readonly treeRoot = signal<KeyTreeNode>({
    segment: '',
    fullRelativePath: null,
    children: [],
  });

  readonly nonSecureKeyCount = computed(() => this.flatKeys().filter(k => !k.isSecure).length);

  readonly displayTree = computed(() => {
    const root = this.treeRoot();
    const q = this.search().trim();
    if (!q) return root;
    return filterTree(root, q) ?? { ...root, children: [] };
  });

  selectedPath = signal<string | null>(null);
  selectedEntry = signal<AppKeyEntry | null>(null);

  /**
   * Tracks the *label* of the selected version badge, e.g. "v1", "v3", or "Custom Revision".
   * This keeps the badge highlight correct regardless of the raw revision numbers.
   */
  selectedVersionLabel = signal<string>('');

  /**
   * True when the user is viewing a historical (non-current) version in the editor.
   * Controls visibility of the "Restore Version" button.
   */
  isViewingHistory = signal<boolean>(false);

  /** The raw etcd revision number for the currently selected version badge (used for API) */
  private selectedVersionRevision = signal<string>('');

  customRevision = signal<string>('');
  editorValue = '';
  private baselineValue = '';

  newRelativePath = '';
  newValue = '';
  isSecureCreate = false;

  // Clone path dialog state
  cloneDialogOpen = signal(false);
  cloneSourcePath = signal('');
  cloneIsSecureFolder = signal(false);
  cloneTargetPath = '';

  ngOnInit(): void {
    this.reload();
  }

  /**
   * Build version badges (v1, v2, v3 …) from etcd key metadata.
   *
   * etcd's `version` field = number of writes since the key was created.
   * `create_revision` = global cluster revision when v1 was written.
   * `mod_revision`    = global cluster revision when vN (current) was written.
   *
   * We show ALL versions (no gaps, no missing badges) so the user can always navigate
   * to any historical version. Intermediate revisions are linearly interpolated.
   */
  getVersionBadges(entry: AppKeyEntry): VersionBadge[] {
    const currentVersion = parseInt(entry.version || '1', 10);
    const modRev = parseInt(entry.modRevision || '0', 10);
    const createRev = parseInt(entry.createRevision || '0', 10);

    // Fallback: single badge when version info is missing
    if (currentVersion <= 0 || modRev <= 0) {
      return [{
        label: 'v1',
        revision: entry.modRevision || entry.createRevision,
        isCurrent: true,
      }];
    }

    const makeRevision = (v: number): string => {
      if (v === 1) return entry.createRevision || entry.modRevision;
      if (v === currentVersion) return entry.modRevision;
      // Linear interpolation between createRev (v1) and modRev (vN)
      const fraction = (v - 1) / Math.max(currentVersion - 1, 1);
      return String(Math.round(createRev + fraction * (modRev - createRev)));
    };

    // Show EVERY version — v1 through vN, no gaps
    const badges: VersionBadge[] = [];
    for (let v = 1; v <= currentVersion; v++) {
      badges.push({
        label: `v${v}`,
        revision: makeRevision(v),
        isCurrent: v === currentVersion,
      });
    }
    return badges;
  }

  /** Called when the user clicks a version badge */
  selectVersionBadge(badge: VersionBadge): void {
    this.selectedVersionLabel.set(badge.label);
    this.selectedVersionRevision.set(badge.revision);

    if (badge.isCurrent) {
      // Viewing the live/current version — no API call needed, hide Restore button
      this.isViewingHistory.set(false);
      const entry = this.selectedEntry();
      if (entry) {
        this.editorValue = entry.isSecure ? '' : entry.value;
        this.baselineValue = entry.isSecure ? '' : entry.value;
        this.snack.open(`Viewing current version (${badge.label})`, 'OK', { duration: 2000 });
      }
    } else {
      // Viewing a historical version — fetch it and show Restore button
      this.isViewingHistory.set(true);
      this.fetchAtRevision();
    }
  }

  /** Fetch the value at a specific etcd revision and load it into the editor */
  fetchAtRevision(): void {
    const app = this.appName();
    const rel = this.selectedPath();

    // Use custom revision if selected, otherwise use the stored raw revision
    const rev = this.selectedVersionLabel() === 'Custom Revision'
      ? this.customRevision().trim()
      : this.selectedVersionRevision().trim();

    if (!app || !rel || !rev) return;
    this.loading.set(true);
    this.etcd
      .rangeByAppPrefixAtRevision(app, rev)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (kvs) => {
          const fullKey = buildFullKey(app, rel);
          const kv = kvs.find((k) => this.etcd.decodeKv(k).key === fullKey);
          if (kv) {
            const decoded = this.etcd.decodeKv(kv);
            const isSecure = this.selectedEntry()?.isSecure ?? false;
            // Load historical value into editor; baselineValue stays as current so isDirty() works
            this.editorValue = isSecure ? '' : decoded.value;
            // Show Restore button whenever we're on a historical version
            this.isViewingHistory.set(this.selectedVersionLabel() !== 'Custom Revision' &&
              !this.getVersionBadges(this.selectedEntry()!).find(b => b.label === this.selectedVersionLabel())?.isCurrent);
            this.snack.open(
              isSecure
                ? `Historical revision ${rev} loaded — secure value not shown`
                : `Loaded value at revision ${rev} (${this.selectedVersionLabel()})`,
              'OK',
              { duration: 2500 }
            );
          } else {
            this.snack.open('Key did not exist at this revision.', 'Dismiss', { duration: 5000 });
          }
        },
        error: (e: Error) => this.snack.open(e.message, 'Dismiss', { duration: 8000 }),
      });
  }

  reload(): void {
    const app = this.appName();
    if (!app) {
      void this.router.navigate(['/']);
      return;
    }
    this.loading.set(true);
    this.etcd
      .rangeByAppPrefix(app)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (kvs) => {
          const prefix = `${app}/`;
          const flat: AppKeyEntry[] = [];
          for (const kv of kvs) {
            const decoded = this.etcd.decodeKv(kv);
            if (!decoded.key.startsWith(prefix)) continue;
            const relativePath = decoded.key.slice(prefix.length);
            if (!relativePath) continue;
            const isSecure = relativePath.startsWith('secure/');
            flat.push({
              relativePath,
              value: decoded.value,
              isSecure,
              modRevision: kv.mod_revision ?? '',
              version: kv.version ?? '',
              createRevision: kv.create_revision ?? '',
            });
          }
          flat.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
          this.flatKeys.set(flat);
          this.treeRoot.set(buildKeyTree(flat));
          const sel = this.selectedPath();
          if (sel && !flat.some((f) => f.relativePath === sel)) {
            this.clearSelection();
          } else if (sel) {
            const row = flat.find((f) => f.relativePath === sel);
            if (row) {
              this.selectedEntry.set(row);
              this.editorValue = row.isSecure ? '' : row.value;
              this.baselineValue = row.isSecure ? '' : row.value;
            }
          }
        },
        error: (e: Error) => this.snack.open(e.message, 'Dismiss', { duration: 8000 }),
      });
  }

  onPick(entry: AppKeyEntry): void {
    this.selectedPath.set(entry.relativePath);
    this.selectedEntry.set(entry);
    // Highlight the CURRENT version badge (e.g. "v3") on selection
    const currentVer = parseInt(entry.version || '1', 10);
    this.selectedVersionLabel.set(`v${currentVer}`);
    this.selectedVersionRevision.set(entry.modRevision);
    this.customRevision.set('');
    // For secure keys: don't pre-fill editor (value is hidden); user must type a new value
    this.editorValue = entry.isSecure ? '' : entry.value;
    this.baselineValue = entry.isSecure ? '' : entry.value;
  }

  clearSelection(): void {
    this.selectedPath.set(null);
    this.selectedEntry.set(null);
    this.selectedVersionLabel.set('');
    this.selectedVersionRevision.set('');
    this.customRevision.set('');
    this.isViewingHistory.set(false);
    this.editorValue = '';
    this.baselineValue = '';
  }

  isDirty(): boolean {
    const p = this.selectedPath();
    if (!p) return false;
    return this.editorValue !== this.baselineValue;
  }

  async saveSelected(): Promise<void> {
    const app = this.appName();
    const rel = this.selectedPath();
    if (!app || !rel) return;
    if (!this.isDirty()) {
      this.snack.open('No changes to save.', 'OK', { duration: 2500 });
      return;
    }
    if (this.baselineValue !== '' && this.editorValue !== this.baselineValue) {
      const ok = await this.confirm(
        'Overwrite value?',
        `Replace the value for "${rel}"?`,
        'Save',
        'primary',
      );
      if (!ok) return;
    }
    const full = buildFullKey(app, rel);
    const isSecure = this.selectedEntry()?.isSecure ?? false;
    const valueToSave = isSecure ? utf8ToBase64(this.editorValue) : this.editorValue;
    this.saving.set(true);
    this.etcd
      .putKey(full, valueToSave)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.baselineValue = this.editorValue;
          this.snack.open('Saved.', 'OK', { duration: 3000 });
          this.reload();
        },
        error: (e: Error) => this.snack.open(e.message, 'Dismiss', { duration: 8000 }),
      });
  }

  async restoreVersion(): Promise<void> {
    const app = this.appName();
    const rel = this.selectedPath();
    if (!app || !rel) return;

    const versionLabel = this.selectedVersionLabel();
    const ok = await this.confirm(
      'Restore version?',
      `Restore ${versionLabel} of "${rel}" as the new current value? This will create a new version.`,
      'Restore',
      'primary',
    );
    if (!ok) return;

    const full = buildFullKey(app, rel);
    const isSecure = this.selectedEntry()?.isSecure ?? false;
    const valueToWrite = isSecure ? utf8ToBase64(this.editorValue) : this.editorValue;
    this.saving.set(true);
    this.etcd
      .putKey(full, valueToWrite)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.baselineValue = this.editorValue;
          this.isViewingHistory.set(false);
          this.snack.open(`${versionLabel} restored as the new current version.`, 'OK', { duration: 3000 });
          this.reload();
        },
        error: (e: Error) => this.snack.open(e.message, 'Dismiss', { duration: 8000 }),
      });
  }

  async deleteSelected(): Promise<void> {
    const app = this.appName();
    const rel = this.selectedPath();
    if (!app || !rel) return;
    const ok = await this.confirm(
      'Delete key?',
      `Delete "${rel}"? This cannot be undone.`,
      'Delete',
      'warn',
    );
    if (!ok) return;
    const full = buildFullKey(app, rel);
    this.saving.set(true);
    this.etcd
      .deleteKey(full)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.snack.open('Deleted.', 'OK', { duration: 3000 });
          this.clearSelection();
          this.reload();
        },
        error: (e: Error) => this.snack.open(e.message, 'Dismiss', { duration: 8000 }),
      });
  }

  createKey(): void {
    const app = this.appName();
    if (!app) return;
    const rel = this.newRelativePath.trim();
    const val = this.newValue;
    if (!isValidRelativePath(rel)) {
      this.snack.open(
        'Use a non-empty relative path without leading slashes (e.g. db/host or key-version).',
        'Dismiss',
        { duration: 6000 },
      );
      return;
    }
    const fullRel = this.isSecureCreate ? `secure/${rel}` : rel;
    const exists = this.flatKeys().some((f) => f.relativePath === fullRel);
    if (exists) {
      this.snack.open(`"${fullRel}" already exists. Select it in the tree to edit.`, 'Dismiss', {
        duration: 5000,
      });
      return;
    }
    const full = buildFullKey(app, fullRel);
    const encodedVal = this.isSecureCreate ? utf8ToBase64(val) : val;
    this.saving.set(true);
    this.etcd
      .putKey(full, encodedVal)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.snack.open('Key created.', 'OK', { duration: 3000 });
          this.newRelativePath = '';
          this.newValue = '';
          this.isSecureCreate = false;
          this.reload();
          this.onPick({
            relativePath: fullRel,
            value: val,
            isSecure: this.isSecureCreate,
            modRevision: '',
            version: '1',
            createRevision: '',
          });
        },
        error: (e: Error) => this.snack.open(e.message, 'Dismiss', { duration: 8000 }),
      });
  }

  exportJson(): void {
    const app = this.appName();
    if (!app) return;
    const obj: Record<string, string> = {};
    for (const row of this.flatKeys()) {
      if (row.isSecure) continue; // never export secure keys
      obj[row.relativePath] = row.value;
    }
    const exportCount = Object.keys(obj).length;
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${app}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.snack.open(`Downloaded ${exportCount} key(s) (secure keys excluded).`, 'OK', { duration: 3000 });
  }

  triggerImport(input: HTMLInputElement): void {
    input.value = '';
    input.click();
  }

  onJsonFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.snack.open('Invalid JSON file.', 'Dismiss', { duration: 6000 });
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.snack.open('JSON must be a flat object of string keys.', 'Dismiss', {
          duration: 6000,
        });
        return;
      }
      void this.runImport(parsed as Record<string, unknown>);
    };
    reader.readAsText(file, 'UTF-8');
  }

  private async runImport(obj: Record<string, unknown>): Promise<void> {
    console.log('runImport', obj);
  }

  openCloneDialog(event: { sourcePath: string; isSecureFolder: boolean }): void {
    this.cloneSourcePath.set(event.sourcePath);
    this.cloneIsSecureFolder.set(event.isSecureFolder);
    this.cloneTargetPath = '';
    this.cloneDialogOpen.set(true);
  }

  closeCloneDialog(): void {
    this.cloneDialogOpen.set(false);
  }

  async executeClone(): Promise<void> {
    const app = this.appName();
    const src = this.cloneSourcePath();
    const dest = this.cloneTargetPath.trim().replace(/^\/+|\/+$/g, '');
    const isSecure = this.cloneIsSecureFolder();

    if (!app || !dest) {
      this.snack.open('Please enter a valid destination path.', 'Dismiss', { duration: 4000 });
      return;
    }
    if (dest === src) {
      this.snack.open('Destination must differ from source.', 'Dismiss', { duration: 4000 });
      return;
    }

    // Gather keys under the source path
    const keysToClone = this.flatKeys().filter((f) => {
      const rel = f.relativePath;
      return rel === src || rel.startsWith(`${src}/`);
    });

    if (!keysToClone.length) {
      this.snack.open('No keys found under that path.', 'Dismiss', { duration: 4000 });
      return;
    }

    const ok = await this.confirm(
      'Clone path?',
      isSecure
        ? `Copy ${keysToClone.length} key name(s) from "${src}" → "${dest}" (secure: keys only, no values).`
        : `Copy ${keysToClone.length} key(s) with values from "${src}" → "${dest}".`,
      'Clone',
      'primary',
    );
    if (!ok) return;

    this.cloneDialogOpen.set(false);
    this.saving.set(true);
    let count = 0;
    const doNext = (idx: number): void => {
      if (idx >= keysToClone.length) {
        this.saving.set(false);
        this.snack.open(`Cloned ${count} key(s) to "${dest}".`, 'OK', { duration: 3500 });
        this.reload();
        return;
      }
      const entry = keysToClone[idx];
      const srcRel = entry.relativePath;
      const suffix = srcRel === src ? '' : srcRel.slice(src.length);
      const destRel = `${dest}${suffix}`;
      const fullDestKey = buildFullKey(app, destRel);
      const valueToWrite = isSecure ? '' : entry.value;

      this.etcd.putKey(fullDestKey, valueToWrite).subscribe({
        next: () => { count++; doNext(idx + 1); },
        error: (e: Error) => {
          this.saving.set(false);
          this.snack.open(`Clone failed at "${destRel}": ${e.message}`, 'Dismiss', { duration: 8000 });
        },
      });
    };
    doNext(0);
  }

  private confirm(
    title: string,
    message: string,
    confirmLabel: string,
    confirmColor: 'primary' | 'accent' | 'warn',
  ): Promise<boolean> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title, message, confirmLabel, confirmColor },
      width: 'min(480px, 92vw)',
    });
    return new Promise((resolve) => {
      ref.afterClosed().subscribe((v) => resolve(Boolean(v)));
    });
  }
}

function isValidRelativePath(p: string): boolean {
  const t = p.trim();
  if (!t || t.startsWith('/') || t.includes('//')) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/.test(t);
}