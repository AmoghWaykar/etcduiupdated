import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { from, Observable, of, throwError, timer } from 'rxjs';
import { catchError, concatMap, map, retry } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  DeleteRangeRequest,
  DeleteRangeResponse,
  EtcdKv,
  PutRequest,
  PutResponse,
  RangeRequest,
  RangeResponse,
} from '../models/etcd.models';
import { base64ToUtf8, utf8ToBase64 } from '../utils/base64';
import { prefixExclusiveEnd } from '../utils/prefix-range';

const JSON_HEADERS = {
  headers: { 'Content-Type': 'application/json' },
};

@Injectable({ providedIn: 'root' })
export class EtcdApiService {
  private readonly http = inject(HttpClient);

  private url(path: string): string {
    const base = environment.etcdBaseUrl.replace(/\/$/, '');
    return `${base}${path}`;
  }

  private withRetry<T>(source: Observable<T>): Observable<T> {
    return source.pipe(
      retry({
        count: 3,
        delay: (_err, retryCount) => timer(Math.min(1500, 250 * retryCount)),
      }),
    );
  }

  private mapHttpError(err: unknown): Observable<never> {
    if (err instanceof HttpErrorResponse) {
      const detail =
        typeof err.error === 'string'
          ? err.error
          : err.error && JSON.stringify(err.error);
      return throwError(
        () =>
          new Error(
            err.status
              ? `HTTP ${err.status}: ${err.statusText}${detail ? ` — ${detail}` : ''}`
              : err.message || 'Network error',
          ),
      );
    }
    return throwError(() => (err instanceof Error ? err : new Error(String(err))));
  }

  /** List all keys with prefix `appName/` (exclusive range). */
  rangeByAppPrefix(appName: string): Observable<EtcdKv[]> {
    const prefix = `${normalizeAppName(appName)}/`;
    const body: RangeRequest = {
      key: utf8ToBase64(prefix),
      range_end: utf8ToBase64(prefixExclusiveEnd(prefix)),
      sort_order: 'ASCEND',
      sort_target: 'KEY',
      serializable: true,
    };
    return this.withRetry(
      this.http.post<RangeResponse>(this.url('/v3/kv/range'), body, JSON_HEADERS).pipe(
        map((res) => res.kvs ?? []),
        catchError((e) => this.mapHttpError(e)),
      ),
    );
  }

  /** List all keys with prefix `appName/` at a specific revision. */
  rangeByAppPrefixAtRevision(appName: string, revision: string): Observable<EtcdKv[]> {
    const prefix = `${normalizeAppName(appName)}/`;
    const body: RangeRequest = {
      key: utf8ToBase64(prefix),
      range_end: utf8ToBase64(prefixExclusiveEnd(prefix)),
      sort_order: 'ASCEND',
      sort_target: 'KEY',
      revision: parseInt(revision, 10),
      serializable: true,
    };
    return this.withRetry(
      this.http.post<RangeResponse>(this.url('/v3/kv/range'), body, JSON_HEADERS).pipe(
        map((res) => res.kvs ?? []),
        catchError((e) => this.mapHttpError(e)),
      ),
    );
  }

  putKey(fullKey: string, value: string): Observable<PutResponse> {
    const body: PutRequest = {
      key: utf8ToBase64(fullKey),
      value: utf8ToBase64(value),
    };
    return this.withRetry(
      this.http.post<PutResponse>(this.url('/v3/kv/put'), body, JSON_HEADERS).pipe(
        catchError((e) => this.mapHttpError(e)),
      ),
    );
  }

  deleteKey(fullKey: string): Observable<DeleteRangeResponse> {
    const body: DeleteRangeRequest = {
      key: utf8ToBase64(fullKey),
    };
    return this.withRetry(
      this.http
        .post<DeleteRangeResponse>(this.url('/v3/kv/deleterange'), body, JSON_HEADERS)
        .pipe(catchError((e) => this.mapHttpError(e))),
    );
  }

  decodeKv(kv: EtcdKv): { key: string; value: string } {
    return {
      key: base64ToUtf8(kv.key),
      value: base64ToUtf8(kv.value ?? ''),
    };
  }

  /**
   * Writes each JSON property as `appName/key` → string value (objects/arrays JSON-stringified).
   * Emits progress after each successful PUT.
   */
  putManyFromJsonObject(
    appName: string,
    obj: Record<string, unknown>,
  ): Observable<{ progress: number; total: number }> {
    const entries = Object.entries(obj).filter(([k]) => k.trim().length > 0);
    const total = entries.length;
    if (!total) return of({ progress: 0, total: 0 });
    return from(entries).pipe(
      concatMap(([k, v], i) => {
        const val = serializeJsonLeafValue(v);
        return this.putKey(buildFullKey(appName, k), val).pipe(
          map(() => ({ progress: i + 1, total })),
        );
      }),
    );
  }
}

function serializeJsonLeafValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Trim and validate app segment used in key prefix. */
export function normalizeAppName(name: string): string {
  return name.trim();
}

export function isValidAppName(name: string): boolean {
  const n = normalizeAppName(name);
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(n);
}

export function buildFullKey(appName: string, relativePath: string): string {
  const rel = relativePath.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${normalizeAppName(appName)}/${rel}`;
}
