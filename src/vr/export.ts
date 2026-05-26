import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { CodeGraph } from '../index';
import type { Edge, FileRecord, Node } from '../types';
import type {
  BuildVRGraphOptions,
  VRGit4DStatus,
  VRGraphEdge,
  VRGraphNode,
  VRGraphPayload,
} from './types';

const DEFAULT_MAX_NODES = 3000;
const DEFAULT_MAX_EDGES = 8000;
const TWO_PI = Math.PI * 2;

const KIND_WEIGHTS: Record<string, number> = {
  file: 1.4,
  class: 1.35,
  interface: 1.25,
  function: 1.2,
  method: 1.2,
  component: 1.15,
  route: 1.15,
  module: 1.1,
  git_commit: 1.1,
  git_file: 1.05,
};

const KIND_COLORS: Record<string, [number, number, number]> = {
  file: [0.32, 0.62, 0.92],
  module: [0.37, 0.68, 0.96],
  class: [0.93, 0.56, 0.28],
  interface: [0.86, 0.71, 0.32],
  function: [0.35, 0.82, 0.58],
  method: [0.27, 0.75, 0.54],
  route: [0.96, 0.38, 0.42],
  component: [0.74, 0.48, 0.94],
  git_commit: [0.95, 0.78, 0.34],
  git_file: [0.56, 0.78, 0.98],
  git4d_unknown: [0.72, 0.72, 0.72],
};

interface Git4DNodeInput {
  id?: unknown;
  kind?: unknown;
  label?: unknown;
  path?: unknown;
  sha?: unknown;
  time?: unknown;
  coords?: unknown;
  metrics?: unknown;
}

interface Git4DEdgeInput {
  source?: unknown;
  target?: unknown;
  kind?: unknown;
  metadata?: unknown;
}

interface Git4DDocument {
  nodes?: unknown;
  edges?: unknown;
}

export function resolveGit4DPath(projectRoot: string, explicitPath?: string): string {
  return path.resolve(explicitPath ?? path.join(projectRoot, 'git4d-results', 'kamui4d-graph.json'));
}

export function buildVRGraph(cg: CodeGraph, options: BuildVRGraphOptions = {}): VRGraphPayload {
  const projectRoot = cg.getProjectRoot();
  const maxNodes = clampInt(options.maxNodes ?? DEFAULT_MAX_NODES, 100, 100_000);
  const maxEdges = clampInt(options.maxEdges ?? DEFAULT_MAX_EDGES, 100, 250_000);
  const stats = cg.getStats();
  const codeGraph = buildCodeGraphLayer(cg, maxNodes, maxEdges);
  const git4dPath = resolveGit4DPath(projectRoot, options.git4dPath);
  const git4d = options.includeGit4D === false
    ? emptyGit4DLayer(git4dPath, false)
    : loadGit4DLayer(git4dPath, maxNodes - codeGraph.nodes.length, maxEdges - codeGraph.edges.length);

  const nodes = [...codeGraph.nodes, ...git4d.nodes].slice(0, maxNodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const bridgeEdges = buildBridgeEdges(codeGraph.fileNodeByPath, git4d.fileNodeByPath, nodeIds);
  const edges = [...codeGraph.edges, ...git4d.edges, ...bridgeEdges]
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .slice(0, maxEdges);

  const git4dStatus = git4d.status;
  git4dStatus.bridgeCount = bridgeEdges.length;

  return {
    schema: 'codegraph.vr.v1',
    generatedAt: new Date().toISOString(),
    projectRoot,
    stats,
    compatibility: {
      renderer: 'webgl-webxr',
      webxrSessionMode: 'immersive-vr',
      quest: 'quest2-plus',
      virtualDesktop: true,
      secureContextRequiredForImmersiveVR: true,
    },
    limits: { maxNodes, maxEdges },
    git4d: git4dStatus,
    nodes,
    edges,
  };
}

function buildCodeGraphLayer(
  cg: CodeGraph,
  maxNodes: number,
  maxEdges: number,
): {
  nodes: VRGraphNode[];
  edges: VRGraphEdge[];
  fileNodeByPath: Map<string, string>;
} {
  const rawNodes = cg.getAllNodes();
  const rawEdges = cg.getAllEdges();
  const files = cg.getFiles();
  const degree = new Map<string, number>();
  for (const edge of rawEdges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const sortedNodes = rawNodes
    .slice()
    .sort((a, b) => scoreNode(b, degree) - scoreNode(a, degree) || a.id.localeCompare(b.id));
  const fileBudget = Math.min(Math.ceil(maxNodes * 0.25), files.length, 750);
  const symbolBudget = Math.max(0, maxNodes - fileBudget);
  const selectedSymbols = sortedNodes.slice(0, symbolBudget);
  const selectedFiles = selectFiles(files, selectedSymbols, fileBudget);
  const fileNodeByPath = new Map<string, string>();
  const fileOrder = buildFileOrder(files);
  const maxLine = Math.max(1, ...selectedSymbols.map((node) => node.startLine || 1));

  const nodes: VRGraphNode[] = [];
  for (const file of selectedFiles) {
    const id = `codegraph:file:${file.path}`;
    fileNodeByPath.set(normalizePathKey(file.path), id);
    nodes.push({
      id,
      source: 'codegraph',
      kind: 'file',
      label: file.path,
      filePath: file.path,
      language: file.language,
      weight: 1 + Math.min(2, file.nodeCount / 50),
      position: filePosition(file.path, fileOrder, 0),
      color: KIND_COLORS.file ?? [0.32, 0.62, 0.92],
      metadata: {
        size: file.size,
        nodeCount: file.nodeCount,
        indexedAt: file.indexedAt,
      },
    });
  }

  for (const node of selectedSymbols) {
    const nodeDegree = degree.get(node.id) ?? 0;
    nodes.push({
      id: `codegraph:${node.id}`,
      source: 'codegraph',
      kind: node.kind,
      label: node.qualifiedName || node.name,
      filePath: node.filePath,
      language: node.language,
      startLine: node.startLine,
      endLine: node.endLine,
      weight: (KIND_WEIGHTS[node.kind] ?? 1) + Math.min(2.5, nodeDegree / 12),
      position: symbolPosition(node, fileOrder, maxLine, nodeDegree),
      color: KIND_COLORS[node.kind] ?? [0.7, 0.76, 0.82],
      metadata: {
        name: node.name,
        qualifiedName: node.qualifiedName,
        isExported: node.isExported,
        isAsync: node.isAsync,
      },
    });
  }

  const selectedIds = new Set(selectedSymbols.map((node) => node.id));
  const edges: VRGraphEdge[] = [];
  for (const node of selectedSymbols) {
    const fileNodeId = fileNodeByPath.get(normalizePathKey(node.filePath));
    if (fileNodeId) {
      edges.push({
        source: fileNodeId,
        target: `codegraph:${node.id}`,
        kind: 'contains',
        sourceType: 'codegraph',
        weight: 0.35,
        color: [0.24, 0.36, 0.48],
      });
    }
  }
  for (const edge of rawEdges) {
    if (!selectedIds.has(edge.source) || !selectedIds.has(edge.target)) continue;
    edges.push(toVREdge(edge));
    if (edges.length >= maxEdges) break;
  }

  return { nodes, edges, fileNodeByPath };
}

function loadGit4DLayer(
  git4dPath: string,
  remainingNodes: number,
  remainingEdges: number,
): {
  nodes: VRGraphNode[];
  edges: VRGraphEdge[];
  fileNodeByPath: Map<string, string>;
  status: VRGit4DStatus;
} {
  const fileNodeByPath = new Map<string, string>();
  const nodeBudget = Math.max(0, remainingNodes);
  const edgeBudget = Math.max(0, remainingEdges);
  const status = emptyGit4DStatus(git4dPath, true);
  if (!fs.existsSync(git4dPath)) {
    return { nodes: [], edges: [], fileNodeByPath, status };
  }

  status.found = true;
  let doc: Git4DDocument;
  try {
    doc = JSON.parse(fs.readFileSync(git4dPath, 'utf-8')) as Git4DDocument;
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err);
    return { nodes: [], edges: [], fileNodeByPath, status };
  }

  const rawNodes = Array.isArray(doc.nodes) ? (doc.nodes as Git4DNodeInput[]) : [];
  const rawEdges = Array.isArray(doc.edges) ? (doc.edges as Git4DEdgeInput[]) : [];
  const selectedRawNodes = rawNodes.slice(0, nodeBudget);
  const maxX = Math.max(1, ...selectedRawNodes.map((node, index) => numberCoord(node, 'x', index)));
  const nodes: VRGraphNode[] = [];

  for (let index = 0; index < selectedRawNodes.length; index += 1) {
    const raw = selectedRawNodes[index];
    if (!raw) continue;
    const rawId = stringValue(raw.id, `node:${index}`);
    const rawKind = stringValue(raw.kind, 'unknown');
    const filePath = rawKind === 'file' ? stringValue(raw.path ?? raw.label, '') : undefined;
    const id = `git4d:${rawId}`;
    const node: VRGraphNode = {
      id,
      source: 'git4d',
      kind: rawKind === 'commit' ? 'git_commit' : rawKind === 'file' ? 'git_file' : 'git4d_unknown',
      label: stringValue(raw.label ?? raw.sha ?? raw.path, rawId),
      filePath,
      weight: rawKind === 'commit' ? 1.2 : 1,
      position: git4dPosition(raw, index, maxX),
      color: rawKind === 'commit'
        ? (KIND_COLORS.git_commit ?? [0.95, 0.78, 0.34])
        : (KIND_COLORS.git_file ?? [0.56, 0.78, 0.98]),
      metadata: {
        sha: stringValue(raw.sha, ''),
        time: stringValue(raw.time, ''),
        metrics: isRecord(raw.metrics) ? raw.metrics : undefined,
      },
    };
    nodes.push(node);
    if (filePath) fileNodeByPath.set(normalizePathKey(filePath), id);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: VRGraphEdge[] = [];
  for (const raw of rawEdges) {
    if (edges.length >= edgeBudget) break;
    const source = `git4d:${stringValue(raw.source, '')}`;
    const target = `git4d:${stringValue(raw.target, '')}`;
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    const kind = stringValue(raw.kind, 'git4d_link');
    edges.push({
      source,
      target,
      kind: kind === 'parent' ? 'git_parent' : kind === 'touches' ? 'git_touches' : 'git4d_link',
      sourceType: 'git4d',
      weight: kind === 'parent' ? 0.7 : 0.4,
      color: kind === 'parent' ? [0.88, 0.68, 0.28] : [0.42, 0.58, 0.76],
      metadata: isRecord(raw.metadata) ? raw.metadata : undefined,
    });
  }

  status.loaded = true;
  status.nodeCount = nodes.length;
  status.edgeCount = edges.length;
  return { nodes, edges, fileNodeByPath, status };
}

function emptyGit4DLayer(git4dPath: string, enabled: boolean): {
  nodes: VRGraphNode[];
  edges: VRGraphEdge[];
  fileNodeByPath: Map<string, string>;
  status: VRGit4DStatus;
} {
  return {
    nodes: [],
    edges: [],
    fileNodeByPath: new Map<string, string>(),
    status: emptyGit4DStatus(git4dPath, enabled),
  };
}

function buildBridgeEdges(
  codeGraphFiles: Map<string, string>,
  git4dFiles: Map<string, string>,
  nodeIds: Set<string>,
): VRGraphEdge[] {
  const edges: VRGraphEdge[] = [];
  for (const [filePath, source] of git4dFiles) {
    const target = codeGraphFiles.get(filePath);
    if (!target || !nodeIds.has(source) || !nodeIds.has(target)) continue;
    edges.push({
      source,
      target,
      kind: 'git4d_link',
      sourceType: 'bridge',
      weight: 0.9,
      color: [0.98, 0.92, 0.42],
      metadata: { filePath },
    });
  }
  return edges;
}

function toVREdge(edge: Edge): VRGraphEdge {
  return {
    source: `codegraph:${edge.source}`,
    target: `codegraph:${edge.target}`,
    kind: edge.kind,
    sourceType: 'codegraph',
    weight: edge.provenance === 'heuristic' ? 0.55 : 0.7,
    color: edge.provenance === 'heuristic' ? [0.74, 0.58, 0.94] : [0.52, 0.68, 0.82],
    metadata: {
      line: edge.line,
      column: edge.column,
      provenance: edge.provenance,
      ...(edge.metadata ?? {}),
    },
  };
}

function selectFiles(files: FileRecord[], selectedNodes: Node[], budget: number): FileRecord[] {
  const wanted = new Set(selectedNodes.map((node) => node.filePath));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const selected: FileRecord[] = [];
  for (const filePath of wanted) {
    const file = byPath.get(filePath);
    if (file) selected.push(file);
    if (selected.length >= budget) return selected;
  }
  for (const file of files) {
    if (selected.length >= budget) break;
    if (!wanted.has(file.path)) selected.push(file);
  }
  return selected;
}

function buildFileOrder(files: FileRecord[]): Map<string, number> {
  const order = new Map<string, number>();
  files
    .map((file) => file.path)
    .sort((a, b) => a.localeCompare(b))
    .forEach((filePath, index) => order.set(filePath, index));
  return order;
}

function scoreNode(node: Node, degree: Map<string, number>): number {
  const degreeScore = degree.get(node.id) ?? 0;
  const kindScore = (KIND_WEIGHTS[node.kind] ?? 1) * 10;
  const exported = node.isExported ? 3 : 0;
  return degreeScore + kindScore + exported;
}

function filePosition(filePath: string, fileOrder: Map<string, number>, yOffset: number): [number, number, number] {
  const count = Math.max(1, fileOrder.size);
  const order = fileOrder.get(filePath) ?? Math.floor(stableUnit(filePath) * count);
  const angle = (order / count) * TWO_PI;
  const radius = 1.72;
  return [
    Math.cos(angle) * radius,
    -0.82 + yOffset,
    Math.sin(angle) * radius,
  ];
}

function symbolPosition(
  node: Node,
  fileOrder: Map<string, number>,
  maxLine: number,
  degree: number,
): [number, number, number] {
  const count = Math.max(1, fileOrder.size);
  const order = fileOrder.get(node.filePath) ?? Math.floor(stableUnit(node.filePath) * count);
  const baseAngle = (order / count) * TWO_PI;
  const jitter = (stableUnit(node.id) - 0.5) * 0.22;
  const radius = 0.55 + Math.min(0.75, degree / 24);
  const lineNorm = Math.min(1, Math.max(0, (node.startLine || 1) / maxLine));
  return [
    Math.cos(baseAngle + jitter) * radius,
    (lineNorm - 0.5) * 1.65,
    Math.sin(baseAngle + jitter) * radius,
  ];
}

function git4dPosition(node: Git4DNodeInput, index: number, maxX: number): [number, number, number] {
  const rawKind = stringValue(node.kind, 'unknown');
  const x = (numberCoord(node, 'x', index) / maxX) * 3.2 - 1.6;
  const y = rawKind === 'commit' ? 0.92 : 1.25;
  const zBase = rawKind === 'commit' ? -1.45 : -1.8;
  const z = zBase + (stableUnit(stringValue(node.id, String(index))) - 0.5) * 0.45;
  return [x, y, z];
}

function numberCoord(node: Git4DNodeInput, key: 'x' | 'y' | 'z', fallback: number): number {
  if (!isRecord(node.coords)) return fallback;
  const value = node.coords[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableUnit(value: string): number {
  const hash = createHash('sha1').update(value).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

function normalizePathKey(value: string): string {
  return value.replace(/\\/g, '/');
}

function emptyGit4DStatus(pathValue: string, enabled: boolean): VRGit4DStatus {
  return {
    enabled,
    path: pathValue,
    found: false,
    loaded: false,
    nodeCount: 0,
    edgeCount: 0,
    bridgeCount: 0,
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
