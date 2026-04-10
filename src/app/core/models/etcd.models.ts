/** etcd v3 JSON gateway request/response shapes (subset). */

export interface EtcdKv {
  key: string;
  value: string;
  create_revision?: string;
  mod_revision?: string;
  version?: string;
  lease?: string;
}

export interface RangeRequest {
  key: string;
  range_end?: string;
  limit?: number;
  revision?: number;
  sort_order?: 'NONE' | 'ASCEND' | 'DESCEND';
  sort_target?: 'KEY' | 'VERSION' | 'CREATE' | 'MOD' | 'VALUE';
  serializable?: boolean;
  keys_only?: boolean;
  count_only?: boolean;
}

export interface RangeResponse {
  header?: {
    cluster_id?: string;
    member_id?: string;
    revision?: string;
    raft_term?: string;
  };
  kvs?: EtcdKv[];
  more?: boolean;
  count?: string;
}

export interface PutRequest {
  key: string;
  value: string;
  lease?: string;
  prev_kv?: boolean;
  ignore_value?: boolean;
  ignore_lease?: boolean;
}

export interface PutResponse {
  header?: RangeResponse['header'];
  prev_kv?: EtcdKv;
}

export interface DeleteRangeRequest {
  key: string;
  range_end?: string;
  prev_kv?: boolean;
}

export interface DeleteRangeResponse {
  header?: RangeResponse['header'];
  deleted?: string;
  prev_kvs?: EtcdKv[];
}

export interface AppKeyEntry {
  /** Path relative to app prefix (may contain `/`). */
  relativePath: string;
  value: string;
  isSecure: boolean;
  modRevision: string;
  version: string;
  createRevision: string;
}
