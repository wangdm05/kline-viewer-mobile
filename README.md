# K线查看器

运行 `npm install`、`npm run dev` 后打开开发服务器地址；`npm run build` 生成可部署的 `dist`。

## GitHub Pages 自动发布

专用仓库：<https://github.com/wangdm05/kline-viewer-mobile>。
发布地址：<https://wangdm05.github.io/kline-viewer-mobile/>，首次 Actions 发布成功后生效。

推送到 `main` 后，`.github/workflows/deploy-pages.yml` 自动运行图表工具测试、构建、PWA 路径和全部内置数据完整性检查，全部通过才发布。Pull Request 执行相同检查；在 Actions 页面也可以手动运行。Pages 的发布来源应设置为 **GitHub Actions**。

工作流从 Pages 配置读取部署路径，自动适配项目子目录和域名根目录。手机主屏幕应用的启动地址、作用范围和图标相对于应用目录解析。可在本地验证项目路径构建：

```sh
npm run build -- --base=/kline-viewer-mobile/
node scripts/verify-pages-build.mjs dist /kline-viewer-mobile/
```

## iPhone 独立访问

用 Safari 打开上述 GitHub Pages 地址，无需登录 GitHub 或 ChatGPT。点击“分享→添加到主屏幕”；如果有“作为网页 App 打开”选项，将其开启。以后从主屏幕图标打开。托管网站不需要电脑开机，也不需要同一 Wi-Fi。大陆网络的连通性需要在实际手机上验证。

首次打开和切换未缓存月份需要联网；已查看的月份缓存在当前浏览器，缓存仍受手机可用空间和系统清理策略影响。CSV 上传在手机本地解析，标注和模板也保存在当前设备浏览器内。

## 手机查看与打包

运行 `npm run package:mobile`，生成 `releases/kline-viewer-mobile-v1.4.zip`。包内包含静态应用、全部内置数据、Mac/Windows 启动文件和手机访问二维码。运行包不需要安装项目依赖；启动需要 Node.js 18+，Mac 也支持使用已有的 Python 3。

解压后双击“启动手机查看.command”，手机和电脑连接同一 Wi-Fi，打开启动窗口显示的地址；使用时保持电脑和该窗口开启。开发项目也可以在构建后运行 `npm run mobile`。端口默认为 5173，可使用 `KLINE_PORT=5174 npm run mobile` 更改。

手机布局支持折叠设置、上一天/下一天、缩放按钮，以及触摸绘图。查看时左右滑动、双指缩放、长按查看价格，支持横屏。划线、矩形标题和模板仍保存在当前浏览器内；电脑与手机的标注不会自动同步。

包内 `app` 目录可以部署到 HTTPS 静态站点。HTTPS 版支持添加到手机主屏幕并缓存已查看月份；未查看的数据仍需联网加载。iPhone 使用 Safari 的“分享→添加到主屏幕”，Android 使用 Chrome 的“安装应用/添加到主屏幕”。局域网 HTTP 版可在线查看，不支持完整 PWA 安装和离线缓存。此交付是手机网页应用，不是 APK/IPA。

## 内置数据

- 已内置 `OI_Full.csv` 的全部 1,026,350 条记录，覆盖 2013-03-26 至 2026-01-30。
- 启动默认加载最新月份，通过“内置月份”切换历史月份。分钟数据按月加载，日K使用完整历史汇总。
- “上传 CSV”仍支持 50MB 内的单文件，上传后可点击“恢复内置数据”返回最新月份。刷新页面重新加载内置数据。
- 成交量来自 `volume`，持仓量来自 `position`（内置月文件中统一命名为 `openInterest`）。
- 数据保存在 `public/data/oi-full`，构建时自动复制至 `dist/data/oi-full`，运行时无需访问原始文件。部署时需包含此目录；数据按已查看月份缓存，不会一次性下载全部历史数据。

更新默认数据时，在项目根目录使用支持直接执行 TypeScript 的 Node.js 版本运行：

```sh
node scripts/prepare-builtin.mts /path/to/OI_Full.csv
npm run build
```

源文件须按时间升序排列且时间戳唯一，包含 `datetime,open,high,low,close,volume,position` 字段。脚本生成月份索引、每日汇总和源文件校验摘要。

运行回归检查：`node --test src/utils/*.test.ts`。

图表按当前可见范围自动标出阶段高低点及局部波峰、波谷，缩放或拖动后重新计算。长期横盘时，连续重复的相近价格合并为代表点；较短区间的两次转折仍分别保留。价格文字数量随窗口宽度控制，阶段高低点优先，其他重要转折可保留小圆点。图上仅显示无框价格数字，避开K线、其他价格文字、线条和矩形轮廓与标题；避让不开时，线条在文字下方留出空隙，文字使用细描边增加对比。矩形填充和普通线条较淡，选中时加粗。

## 原始 Vite 模板说明

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
