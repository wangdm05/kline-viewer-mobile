import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../dist'));
const port = Number(process.env.KLINE_PORT ?? 5173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    let served = file;
    let gzip = false;
    if ((req.headers['accept-encoding'] ?? '').includes('gzip')) {
      try { if ((await stat(file + '.gz')).isFile()) { served = file + '.gz'; gzip = true; } } catch { /* Use the original asset. */ }
    }
    const info = await stat(served);
    if (!info.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': file.endsWith('sw.js') || file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept-Encoding',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(served).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 400);
    res.end('文件不存在或地址无效');
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请关闭旧的启动窗口后重试，或设置 KLINE_PORT。` : error.message);
  process.exitCode = 1;
});
server.listen(port, '0.0.0.0', () => {
  console.log(`\nK线查看器已启动\n电脑访问：http://localhost:${port}/\n手机和电脑连接同一 Wi-Fi 后，在手机浏览器打开：`);
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (/^(utun|lo|docker|veth)/.test(name)) continue;
    for (const address of entries ?? []) {
      if (address.family === 'IPv4' && !address.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address)) {
        console.log(`  http://${address.address}:${port}/`);
      }
    }
  }
  console.log('\n保持此窗口和电脑开启；按 Control+C 停止。\n');
});
