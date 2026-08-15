import type { EdgeKind, GraphStats, Language, NodeKind } from '../types';

export type VRNodeSource = 'codegraph' | 'git4d';
export type VREdgeSource = 'codegraph' | 'git4d' | 'bridge';

export interface VRGraphNode {
  id: string;
  source: VRNodeSource;
  kind: NodeKind | 'git_commit' | 'git_file' | 'git4d_unknown';
  label: string;
  filePath?: string;
  language?: Language;
  startLine?: number;
  endLine?: number;
  weight: number;
  position: [number, number, number];
  color: [number, number, number];
  metadata?: Record<string, unknown>;
}

export interface VRGraphEdge {
  source: string;
  target: string;
  kind: EdgeKind | 'git_parent' | 'git_touches' | 'git4d_link';
  sourceType: VREdgeSource;
  weight: number;
  color: [number, number, number];
  metadata?: Record<string, unknown>;
}

export interface VRGit4DStatus {
  enabled: boolean;
  path: string;
  found: boolean;
  loaded: boolean;
  error?: string;
  nodeCount: number;
  edgeCount: number;
  bridgeCount: number;
}

export interface VRGraphPayload {
  schema: 'codegraph.vr.v1';
  generatedAt: string;
  projectRoot: string;
  stats: GraphStats;
  compatibility: {
    renderer: 'webgl-webxr';
    webxrSessionMode: 'immersive-vr';
    webxrSessionModes: Array<'immersive-vr' | 'immersive-ar'>;
    quest: 'quest2-plus';
    virtualDesktop: true;
    secureContextRequiredForImmersiveVR: true;
  };
  limits: {
    maxNodes: number;
    maxEdges: number;
  };
  git4d: VRGit4DStatus;
  nodes: VRGraphNode[];
  edges: VRGraphEdge[];
}

export interface BuildVRGraphOptions {
  maxNodes?: number;
  maxEdges?: number;
  includeGit4D?: boolean;
  git4dPath?: string;
}

export interface VRServerOptions extends BuildVRGraphOptions {
  projectRoot: string;
  host?: string;
  port?: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}

export interface VRServerHandle {
  close: () => Promise<void>;
  url: string;
  localUrl: string;
  lanUrl?: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
}
