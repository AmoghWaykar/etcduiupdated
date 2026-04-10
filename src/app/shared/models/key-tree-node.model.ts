import { AppKeyEntry } from '../../core/models/etcd.models';

export interface KeyTreeNode {
  segment: string;
  /** Relative path under app prefix when this node holds a value. */
  fullRelativePath: string | null;
  value?: string;
  entry?: AppKeyEntry;
  children: KeyTreeNode[];
}
