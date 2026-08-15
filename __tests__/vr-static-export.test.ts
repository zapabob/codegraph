import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeVRStaticBundle } from '../src/vr/static-export';
import type { VRGraphPayload } from '../src/vr/types';

describe('VR static export', () => {
  it('writes portable viewer assets and redacts local paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-vr-static-'));
    const privateRoot = path.join(root, 'private-worktree');
    const output = path.join(root, 'viewer');
    const graph: VRGraphPayload = {
      schema: 'codegraph.vr.v1',
      generatedAt: '2026-08-15T00:00:00.000Z',
      projectRoot: privateRoot,
      stats: {
        nodeCount: 1,
        edgeCount: 0,
        fileCount: 1,
        nodesByKind: { function: 1 },
        edgesByKind: {},
        filesByLanguage: { typescript: 1 },
        dbSizeBytes: 0,
        lastUpdated: 0,
      },
      compatibility: {
        renderer: 'webgl-webxr',
        webxrSessionMode: 'immersive-vr',
        webxrSessionModes: ['immersive-vr', 'immersive-ar'],
        quest: 'quest2-plus',
        virtualDesktop: true,
        secureContextRequiredForImmersiveVR: true,
      },
      limits: { maxNodes: 100, maxEdges: 100 },
      git4d: {
        enabled: true,
        path: path.join(privateRoot, 'git4d-results', 'kamui4d-graph.json'),
        found: true,
        loaded: false,
        error: `Could not read ${privateRoot}`,
        nodeCount: 0,
        edgeCount: 0,
        bridgeCount: 0,
      },
      nodes: [],
      edges: [],
    };

    try {
      const result = writeVRStaticBundle(output, graph, 'codegraph');
      const written = fs.readFileSync(result.graphPath, 'utf-8');
      const publicGraph = JSON.parse(written) as VRGraphPayload;

      expect(fs.existsSync(result.entrypoint)).toBe(true);
      expect(fs.existsSync(path.join(output, 'style.css'))).toBe(true);
      expect(fs.existsSync(path.join(output, 'client.js'))).toBe(true);
      expect(fs.readFileSync(result.entrypoint, 'utf-8')).toContain('href="style.css"');
      expect(fs.readFileSync(result.entrypoint, 'utf-8')).toContain('id="arButton"');
      expect(fs.readFileSync(path.join(output, 'client.js'), 'utf-8')).toContain("fetch('graph.json'");
      expect(fs.readFileSync(path.join(output, 'client.js'), 'utf-8')).toContain('immersive-ar');
      expect(publicGraph.projectRoot).toBe('codegraph');
      expect(publicGraph.git4d.path).toBe('kamui4d-graph.json');
      expect(publicGraph.git4d.error).toBe('Git4D export could not be loaded.');
      expect(written).not.toContain(privateRoot);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
