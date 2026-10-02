import { cp, mkdir, readFile, readdir, writeFile, chmod, rm } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import QRCode from 'qrcode';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(project, 'releases');
const name = 'kline-viewer-mobile-v1.4';
const bundle = join(output, name);
const app = join(bundle, 'app');
await mkdir(output, { recursive: true });
// Remove only the generated app copy so older build assets cannot leak in.
await rm(app, { recursive: true, force: true });
await cp(join(project, 'dist'), app, { recursive: true, force: true });
await cp(join(project, 'scripts/serve-mobile.mjs'), join(bundle, 'serve-mobile.mjs'));

async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compress(path);
    else if (['.js', '.css', '.html', '.json', '.csv', '.svg', '.webmanifest'].includes(extname(path))) {
      await writeFile(path + '.gz', gzipSync(await readFile(path), { level: 9 }));
    }
  }
}
await compress(app);
const launcher = `#!/bin/bash
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  exec node ./serve-mobile.mjs ./app
elif command -v python3 >/dev/null 2>&1; then
  printf 'K线查看器已启动。手机与电脑连接同一 Wi-Fi 后，打开下列地址：\\n'
  for device in en0 en1; do
    address=$(ipconfig getifaddr "$device" 2>/dev/null)
    if [ -n "$address" ]; then printf 'http://%s:5173/\\n' "$address"; fi
  done
  printf '保持此窗口和电脑开启；按 Control+C 停止。\\n'
  exec python3 -m http.server 5173 --bind 0.0.0.0 --directory ./app
else
  printf '请先安装 Node.js 18 或更新版本，然后重新双击启动文件。\\n'
  read -r -p '按回车键关闭。' answer
fi
`;
await writeFile(join(bundle, '启动手机查看.command'), launcher);
await chmod(join(bundle, '启动手机查看.command'), 0o755);
const addresses = Object.entries(networkInterfaces()).filter(([name]) => !/^(utun|lo|docker|veth)/.test(name))
  .flatMap(([, entries]) => entries ?? []).filter(a => a.family === 'IPv4' && !a.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address));
const url = `http://${addresses[0]?.address ?? 'localhost'}:5173/`;
await QRCode.toFile(join(bundle, '手机访问二维码.png'), url, { width: 480, margin: 3, errorCorrectionLevel: 'M' });
const instructions = `K线查看器 手机查看版 v1.4

一、同一 Wi-Fi 下使用
1. 将压缩包解压到电脑。
2. 在 Mac 上双击“启动手机查看.command”。如端口被占用，先关闭之前的启动窗口。
3. 手机和电脑连接同一 Wi-Fi，打开启动窗口显示的手机地址。
4. 打包时的地址为 ${url}，也可以扫描“手机访问二维码.png”。电脑 IP 变化后，以启动窗口地址为准。
5. 查看时保持电脑开机、网络连接和启动窗口开启。不要直接在手机上解压后点击 index.html。
6. 启动需要 Node.js 18+，或电脑已有的 Python 3。运行包不需要 npm install。

二、手机操作
左右滑动：浏览分钟K线；双指缩放：改变可见区间；长按：查看十字光标与对应日K。
“上一天/下一天”：快速切换日期。“设置”：展开时间筛选、成交量、持仓量和绘图工具。
矩形和趋势线：依次轻点两个位置；选择模式下拖动标注，拖动角点调整矩形。
“＋/−/全览”：调整可见K线数量。横屏可以显示更多行情。
内置数据覆盖 2013-03-26 至 2026-01-30，共 1,026,350 条分钟记录。CSV 上传仍保留，单文件上限 50MB。
标注、模板和主题保存在当前手机浏览器内，不会自动同步电脑上的标注；清除浏览器数据会移除它们。

三、桌面图标和外出访问
局域网 HTTP 地址适合在线浏览，不支持完整 PWA 安装和离线缓存。
app 目录是可直接部署的静态网站；部署到 HTTPS 地址后，可以作为 PWA 安装。
iPhone：用 Safari 打开 HTTPS 地址，点“分享”，选择“添加到主屏幕”。
Android：用 Chrome 打开 HTTPS 地址，菜单选择“安装应用”或“添加到主屏幕”。
HTTPS 版自动缓存已查看的月份；未查看的月份仍需联网加载。浏览器可能清理缓存。
该包不包含 Android APK 或 iOS IPA，也不包含尚未集成到界面的策略回测功能。
`;
await writeFile(join(bundle, '手机使用说明.txt'), instructions);
await writeFile(join(bundle, '启动手机查看.bat'), '@echo off\r\ncd /d "%~dp0"\r\nnode serve-mobile.mjs app\r\npause\r\n');
const zip = join(output, name + '.zip');
// Python's ZIP writer preserves UTF-8 launcher names and executable mode.
execFileSync('python3', ['-c', `
import sys,zipfile
from pathlib import Path
source=Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(source.rglob('*')):
        if file.is_file(): archive.write(file, file.relative_to(source.parent))
`, bundle, zip]);
console.log(JSON.stringify({ package: zip, directory: bundle, phoneUrl: url }, null, 2));
