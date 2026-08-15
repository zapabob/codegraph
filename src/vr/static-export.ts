import * as fs from 'fs';
import * as path from 'path';
import CodeGraph from '../index';
import { VR_CLIENT_JS, VR_CSS, VR_HTML } from './assets';
import { buildVRGraph } from './export';
import type { BuildVRGraphOptions, VRGraphPayload } from './types';

export interface WriteVRStaticExportOptions extends BuildVRGraphOptions {
  projectRoot: string;
  outputDir: string;
  /** Public label in place of the local absolute project path. */
  projectLabel?: string;
}

export interface VRStaticExportResult {
  outputDir: string;
  entrypoint: string;
  graphPath: string;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Write the existing WebGL/WebXR viewer and a bounded graph snapshot as a
 * portable static bundle. This makes the viewer suitable for static hosts such
 * as GitHub Pages without exposing the local project root or Git4D path.
 */
export function writeVRStaticExport(options: WriteVRStaticExportOptions): VRStaticExportResult {
  const cg = CodeGraph.openSync(options.projectRoot);
  try {
    const graph = buildVRGraph(cg, options);
    return writeVRStaticBundle(options.outputDir, graph, options.projectLabel);
  } finally {
    cg.close();
  }
}

/** Write a previously-built graph payload as a privacy-safe static viewer. */
export function writeVRStaticBundle(
  outputDir: string,
  graph: VRGraphPayload,
  projectLabel?: string,
): VRStaticExportResult {
  const resolvedOutput = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutput, { recursive: true });

  const publicGraph = toPublicVRGraphPayload(graph, projectLabel);
  const entrypoint = path.join(resolvedOutput, 'index.html');
  const graphPath = path.join(resolvedOutput, 'graph.json');

  fs.writeFileSync(entrypoint, VR_HTML, 'utf-8');
  fs.writeFileSync(path.join(resolvedOutput, 'style.css'), VR_CSS, 'utf-8');
  fs.writeFileSync(path.join(resolvedOutput, 'client.js'), VR_CLIENT_JS, 'utf-8');
  fs.writeFileSync(graphPath, `${JSON.stringify(publicGraph, null, 2)}\n`, 'utf-8');

  return {
    outputDir: resolvedOutput,
    entrypoint,
    graphPath,
    nodeCount: publicGraph.nodes.length,
    edgeCount: publicGraph.edges.length,
  };
}

/**
 * Remove local filesystem identifiers before a graph leaves the developer's
 * machine. Symbol and file identifiers stay intact because they are the graph
 * itself; only host-specific roots and diagnostic paths are redacted.
 */
export function toPublicVRGraphPayload(graph: VRGraphPayload, projectLabel?: string): VRGraphPayload {
  const fallbackLabel = path.basename(graph.projectRoot) || 'codegraph';
  const label = projectLabel?.trim() || fallbackLabel;
  const git4d = {
    ...graph.git4d,
    path: graph.git4d.found ? path.basename(graph.git4d.path) : 'not-included',
    error: graph.git4d.error ? 'Git4D export could not be loaded.' : undefined,
  };

  return {
    ...graph,
    projectRoot: label,
    git4d,
  };
}
