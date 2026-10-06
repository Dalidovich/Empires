import { createReadStream, existsSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
};

export interface StaticServer {
  url: string;
  requests: { path: string; status: number }[];
  close(): Promise<void>;
}

export function startStaticServer(directory: string, port = 0, prefix = '/'): Promise<StaticServer> {
  const root = resolve(directory);
  const requests: StaticServer['requests'] = [];
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const finish = (status: number): void => {
      requests.push({ path, status });
      response.writeHead(status);
      response.end();
    };
    if (request.method !== 'GET' || !path.startsWith(prefix)) {
      finish(request.method === 'GET' ? 404 : 405);
      return;
    }
    const relative = path.slice(prefix.length);
    const file = normalize(join(root, relative === '' || relative.endsWith('/') ? `${relative}index.html` : relative));
    if (!(file === root || file.startsWith(root + sep)) || !existsSync(file) || !statSync(file).isFile()) {
      finish(404);
      return;
    }
    requests.push({ path, status: 200 });
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': statSync(file).size,
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((ready) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      ready({
        url: `http://127.0.0.1:${address.port}${prefix}`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] && /staticServer\.ts$/.test(process.argv[1])) {
  const [directory = 'dist', port = '4173', prefix = '/'] = process.argv.slice(2);
  void startStaticServer(directory, Number(port), prefix).then((server) => {
    process.stdout.write(`${server.url}\n`);
  });
}
