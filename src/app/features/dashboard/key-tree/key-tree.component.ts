import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { KeyTreeNode } from '../../../shared/models/key-tree-node.model';
import { AppKeyEntry } from '../../../core/models/etcd.models';

@Component({
  selector: 'app-key-tree',
  imports: [KeyTreeComponent, MatIconModule, MatTooltipModule],
  templateUrl: './key-tree.component.html',
  styleUrl: './key-tree.component.scss',
})
export class KeyTreeComponent {
  @Input({ required: true }) node!: KeyTreeNode;
  @Input() selectedPath: string | null = null;
  @Output() readonly pick = new EventEmitter<AppKeyEntry>();
  @Output() readonly clonePath = new EventEmitter<{ sourcePath: string; isSecureFolder: boolean }>();

  onNodeClick(n: KeyTreeNode, ev: Event): void {
    if (!n.fullRelativePath || !n.entry) return;
    ev.stopPropagation();
    this.pick.emit(n.entry);
  }

  onCloneFolder(n: KeyTreeNode, ev: Event): void {
    ev.stopPropagation();
    // For folder nodes, derive path from first descendant leaf
    const sourcePath = this.folderPath(n);
    const isSecureFolder = sourcePath === 'secure' || sourcePath.startsWith('secure/');
    this.clonePath.emit({ sourcePath, isSecureFolder });
  }

  /** Derive the relative path prefix for a folder node at any depth.
   *
   * Walk to the first leaf descendant and use its `fullRelativePath` to reconstruct
   * this folder's path. We count the nesting depth from this node to the leaf so we
   * can strip exactly the right number of trailing segments — this is correct whether
   * the folder is a direct root child (e.g. "mahajan") or a deeper node (e.g. "mahajan/shubham").
   */
  private folderPath(n: KeyTreeNode): string {
    if (n.fullRelativePath) return n.fullRelativePath;

    let depth = 0;
    let cur: KeyTreeNode = n;
    while (cur.children.length > 0) {
      cur = cur.children[0];
      depth++;
      if (cur.fullRelativePath) {
        // cur.fullRelativePath has `depth` extra segments compared to this folder's path.
        const parts = cur.fullRelativePath.split('/');
        return parts.slice(0, parts.length - depth).join('/');
      }
    }
    // Fallback (no leaf found — should never happen in a well-formed tree)
    return n.segment;
  }

  leafValuePreview(v: string | undefined, isSecure?: boolean): string {
    if (isSecure) return '••••••••';
    const s = v ?? '';
    if (s.length <= 46) return s;
    return `${s.slice(0, 46)}…`;
  }

  iconFor(n: KeyTreeNode): string {
    return n.fullRelativePath ? 'description' : 'folder';
  }

  trackKey(n: KeyTreeNode): string {
    return `${n.segment}::${n.fullRelativePath ?? ''}`;
  }
}