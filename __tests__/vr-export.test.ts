import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildVRGraph } from '../src/vr/export';
import type { CodeGraph } from '../src';
import type { Edge, FileRecord, GraphStats, Node } from '../src/types';

function fakeCodeGraph(root: string, nodes: Node[], edges: Edge[], files: FileRecord[]): CodeGraph {
  const stats: GraphStats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    fileCount: files.length,
    nodesByKind: { function: nodes.length } as GraphStats['nodesByKind'],
    edgesByKind: {} as GraphStats['edgesByKind'],
    filesByLanguage: { typescript: files.length } as GraphStats['filesByLanguage'],
    dbSizeBytes: 0,
    lastUpdated: Date.now(),
  };
  return {
    getProjectRoot: () => root,
    getStats: () => stats,
    getVisualizationSnapshot: (nodeLimit: number, edgeLimit: number) => ({
      nodes: nodes.slice(0, nodeLimit),
      edges: edges.slice(0, edgeLimit),
    }),
    // These throw if a future refactor puts whole-index hydration back into
    // the exporter rather than using the bounded visualization snapshot.
    getAllNodes: () => { throw new Error('VR export must not read all nodes'); },
    getAllEdges: () => { throw new Error('VR export must not read all edges'); },
    getFiles: () => files,
  } as unknown as CodeGraph;
}

describe('VR graph export', () => {
  it('exports codegraph nodes and links matching git4d files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-vr-'));
    try {
      const git4dPath = path.join(root, 'kamui4d-graph.json');
      fs.writeFileSync(git4dPath, JSON.stringify({
        nodes: [
          { id: 'commit:abc', kind: 'commit', label: 'abc init', coords: { x: 0, y: 0, z: 1 } },
          { id: 'file:src/app.ts', kind: 'file', label: 'src/app.ts', path: 'src/app.ts' },
        ],
        edges: [
          { source: 'commit:abc', target: 'file:src/app.ts', kind: 'touches' },
        ],
      }));

      const nodes: Node[] = [{
        id: 'n1',
        kind: 'function',
        name: 'main',
        qualifiedName: 'main',
        filePath: 'src/app.ts',
        language: 'typescript',
        startLine: 1,
        endLine: 2,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      }];
      const files: FileRecord[] = [{
        path: 'src/app.ts',
        contentHash: 'hash',
        language: 'typescript',
        size: 42,
        modifiedAt: 0,
        indexedAt: 0,
        nodeCount: 1,
      }];

      const graph = buildVRGraph(fakeCodeGraph(root, nodes, [], files), {
        git4dPath,
        maxNodes: 20,
        maxEdges: 20,
      });

      expect(graph.schema).toBe('codegraph.vr.v1');
      expect(graph.git4d.loaded).toBe(true);
      expect(graph.git4d.bridgeCount).toBe(1);
      expect(graph.edges.some((edge) => edge.kind === 'git4d_link')).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
