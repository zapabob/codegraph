import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as fs from 'fs';
import { URL } from 'url';
import CodeGraph from '../index';
import { buildVRGraph } from './export';
import { VR_CLIENT_JS, VR_CSS, VR_HTML } from './assets';
import type { VRServerHandle, VRServerOptions } from './types';

export async function startVRServer(options: VRServerOptions): Promise<VRServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = normalizePort(options.port);
  const protocol = options.tlsCertPath && options.tlsKeyPath ? 'https' : 'http';
  const cg = CodeGraph.openSync(options.projectRoot);

  const handler: http.RequestListener = (req, res) => {
    const requestUrl = new URL(req.url ?? '/', `${protocol}://${host}`);
    try {
      if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
        return send(res, 200, 'text/html; charset=utf-8', VR_HTML);
      }
      if (requestUrl.pathname === '/style.css') {
        return send(res, 200, 'text/css; charset=utf-8', VR_CSS);
      }
      if (requestUrl.pathname === '/client.js') {
        return send(res, 200, 'application/javascript; charset=utf-8', VR_CLIENT_JS);
      }
      if (requestUrl.pathname === '/healthz') {
        return sendJson(res, 200, { ok: true, projectRoot: cg.getProjectRoot() });
      }
      if (requestUrl.pathname === '/graph.json') {
        const graph = buildVRGraph(cg, {
          maxNodes: options.maxNodes,
          maxEdges: options.maxEdges,
          includeGit4D: options.includeGit4D,
          git4dPath: options.git4dPath,
        });
        return sendJson(res, 200, graph);
      }
      return sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const server = protocol === 'https'
    ? https.createServer({
      cert: fs.readFileSync(options.tlsCertPath as string),
      key: fs.readFileSync(options.tlsKeyPath as string),
    }, handler)
    : http.createServer(handler);

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const localUrl = `${protocol}://${displayHost}:${boundPort}/`;
  const lanHost = findLanAddress();

  return {
    url: localUrl,
    localUrl,
    lanUrl: lanHost ? `${protocol}://${lanHost}:${boundPort}/` : undefined,
    host,
    port: boundPort,
    protocol,
    close: () => new Promise<void>((resolve, reject) => {
      cg.close();
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
  };
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body, null, 2));
}

function findLanAddress(): string | undefined {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return undefined;
}

function normalizePort(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 8734;
  return Math.max(1, Math.min(65535, Math.floor(value)));
}
