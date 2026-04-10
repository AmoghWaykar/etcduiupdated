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

  /** Derive the relative path prefix for a folder node from its first leaf descendant. */
  private folderPath(n: KeyTreeNode): string {
    if (n.fullRelativePath) return n.fullRelativePath;
    // Walk to first leaf to get the prefix
    let cur: KeyTreeNode = n;
    const segments: string[] = [n.segment];
    while (cur.children.length > 0) {
      cur = cur.children[0];
      if (cur.fullRelativePath) {
        // fullRelativePath is the full relative path of the leaf;
        // strip the leaf segment to get the folder prefix
        const parts = cur.fullRelativePath.split('/');
        parts.pop();
        return parts.join('/');
      }
      segments.push(cur.segment);
    }
    return segments.join('/');
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
