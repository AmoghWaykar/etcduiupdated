import { KeyTreeNode } from '../../shared/models/key-tree-node.model';
import { AppKeyEntry } from '../models/etcd.models';

/** Build a folder tree from flat relative paths (values at leaves). */
export function buildKeyTree(
  entries: AppKeyEntry[],
): KeyTreeNode {
  const root: KeyTreeNode = {
    segment: '',
    fullRelativePath: null,
    children: [],
  };
  for (const entry of entries) {
    const parts = entry.relativePath.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    insertPath(root, parts, entry, '');
  }
  sortTree(root);
  return root;
}

function insertPath(
  node: KeyTreeNode,
  parts: string[],
  entry: AppKeyEntry,
  prefix: string,
): void {
  const [head, ...rest] = parts;
  const rel = prefix ? `${prefix}/${head}` : head;
  let child = node.children.find((c) => c.segment === head);
  if (!child) {
    child = {
      segment: head,
      fullRelativePath: null,
      children: [],
    };
    node.children.push(child);
  }
  if (rest.length === 0) {
    child.fullRelativePath = rel;
    child.value = entry.value;
    child.entry = entry;
  } else {
    insertPath(child, rest, entry, rel);
  }
}

function sortTree(node: KeyTreeNode): void {
  node.children.sort((a, b) => a.segment.localeCompare(b.segment));
  for (const c of node.children) sortTree(c);
}

/** Hide branches that do not match query (case-insensitive substring on path or segment). */
export function filterTree(node: KeyTreeNode, query: string): KeyTreeNode | null {
  const q = query.trim().toLowerCase();
  if (!q) return cloneShallow(node);

  const out: KeyTreeNode[] = [];
  for (const c of node.children) {
    const pathStr = (c.fullRelativePath ?? '').toLowerCase();
    const selfMatch = pathStr.includes(q) || c.segment.toLowerCase().includes(q);
    const sub = filterTree(c, query);
    if (selfMatch) {
      out.push(cloneShallow(c));
    } else if (sub && sub.children.length > 0) {
      out.push(sub);
    }
  }
  return {
    segment: node.segment,
    fullRelativePath: node.fullRelativePath,
    value: node.value,
    entry: node.entry,
    children: out,
  };
}

function cloneShallow(node: KeyTreeNode): KeyTreeNode {
  return {
    segment: node.segment,
    fullRelativePath: node.fullRelativePath,
    value: node.value,
    entry: node.entry,
    children: node.children.map(cloneShallow),
  };
}
