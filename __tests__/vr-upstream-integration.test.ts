/** Fork entry points must keep working against the real, current official API. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph } from '../src';
import { WASM_RUNTIME_FLAGS } from '../src/extraction/wasm-runtime-flags';
import { ToolHandler } from '../src/mcp/tools';
import { buildVRGraph } from '../src/vr/export';
import type { VRGraphPayload } from '../src/vr/types';

describe('VR/AR compatibility with official CodeGraph', () => {
  let root: string;
  let cg: CodeGraph;
  let handler: ToolHandler | undefined;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-vr-api-'));
    fs.writeFileSync(path.join(root, 'app.ts'), [
      'export function target() { return 42; }',
      'export function entry() { return target(); }',
    ].join('\n'));
    cg = await CodeGraph.init(root, { index: true });
    vi.stubEnv('CODEGRAPH_MCP_TOOLS', 'explore,vr');
  });

  afterEach(async () => {
    await handler?.closeAll();
    handler = undefined;
    cg?.close();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads a bounded snapshot from the current SQLite schema and exports connected symbols', () => {
    const snapshot = cg.getVisualizationSnapshot(100, 100);
    expect(snapshot.nodes.some(node => node.name === 'entry')).toBe(true);
    expect(snapshot.edges.some(edge => edge.kind === 'calls')).toBe(true);
    expect(cg.getVisualizationSnapshot(1, 0).nodes).toHaveLength(1);
    expect(cg.getVisualizationSnapshot(1, 0).edges).toEqual([]);
    expect(cg.getVisualizationSnapshot(0, 100)).toEqual({ nodes: [], edges: [] });
    expect(cg.getVisualizationSnapshot(100, 100)).toEqual(snapshot);

    const graph = buildVRGraph(cg, { includeGit4D: false });
    const ids = new Set(graph.nodes.map(node => node.id));
    expect(graph.edges.some(edge => edge.kind === 'calls')).toBe(true);
    expect(graph.edges.every(edge => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
    expect(graph.compatibility.webxrSessionModes).toEqual(['immersive-vr', 'immersive-ar']);
  });

  it('prepares a VR launch command through the current MCP project lifecycle', async () => {
    handler = new ToolHandler(cg);
    const result = await handler.execute('codegraph_vr', {});
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain('codegraph vr');
    expect(result.content[0].text).toContain('Git4D: not found');
    expect(result.content[0].text).not.toContain('getProjectRoot is not a function');
  });

  it('retains the project boundary for Git4D paths after the API migration', async () => {
    handler = new ToolHandler(cg);
    const result = await handler.execute('codegraph_vr', { git4dPath: '../outside.json' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/within|outside|traversal|not allowed/i);
  });

  it('exports the indexed project through the built CLI with a public label', () => {
    const output = path.join(root, 'static-viewer');
    const result = spawnSync(process.execPath, [
      ...WASM_RUNTIME_FLAGS,
      path.resolve(__dirname, '../dist/bin/codegraph.js'),
      'vr', root, '--export', output, '--label', 'public-project', '--no-git4d',
    ], { encoding: 'utf8', timeout: 30_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const serialized = fs.readFileSync(path.join(output, 'graph.json'), 'utf8');
    const graph = JSON.parse(serialized) as VRGraphPayload;
    expect(graph.projectRoot).toBe('public-project');
    expect(graph.nodes.some(node => node.label === 'entry')).toBe(true);
    expect(serialized).not.toContain(root);
    expect(fs.readFileSync(path.join(output, 'client.js'), 'utf8')).toContain('immersive-ar');
  });
});
