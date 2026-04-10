import { Injectable, signal, computed } from '@angular/core';
import { normalizeAppName } from './etcd-api.service';

const STORAGE_KEY = 'etcd-dashboard.appName';
const RECENTS_KEY = 'etcd-dashboard.recentApps';
const MAX_RECENTS = 12;

@Injectable({ providedIn: 'root' })
export class AppStateService {
  private readonly _appName = signal<string>(this.readStored());

  readonly appName = this._appName.asReadonly();

  readonly hasApp = computed(() => normalizeAppName(this._appName()).length > 0);

  readonly recentApps = signal<string[]>(this.readRecents());

  setAppName(name: string): void {
    const n = normalizeAppName(name);
    this._appName.set(n);
    if (n) {
      try {
        localStorage.setItem(STORAGE_KEY, n);
      } catch {
        /* ignore quota */
      }
      this.pushRecent(n);
    }
  }

  clearApp(): void {
    this._appName.set('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  private readStored(): string {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private readRecents(): string[] {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private pushRecent(app: string): void {
    const list = this.recentApps().filter((a) => a !== app);
    list.unshift(app);
    const next = list.slice(0, MAX_RECENTS);
    this.recentApps.set(next);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
}
