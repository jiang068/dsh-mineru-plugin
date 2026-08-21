// 构建浏览器侧插件包：esbuild 把 src/client/index.tsx 打成 CJS，
// 再包成 dsh 客户端模块系统要求的 __ModuleLoader__.load 工厂格式
// （与 dsh-passwords 产物同构）。
// 产物：dist/client.js（dsh 通过 /plugins/<id>/client.js 分发）。
//
// esbuild 解析：优先装好的依赖；开发机上没装 npm 依赖时回退到
// /opt/dsh-passwords/node_modules 里已有的 esbuild 实现（离线可用）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

let build;
try {
  ({ build } = await import('esbuild'));
} catch {
  const local = '/opt/dsh-passwords/node_modules/esbuild/lib/main.js';
  const esm = await import(pathToFileURL(local).href).catch((e) => {
    console.error('esbuild 与本地回退均加载失败:', e.message);
    console.error('请先 `pnpm add -D esbuild` 再构建。');
    process.exit(1);
  });
  build = esm.build;
  console.log('用本地 esbuild 构建客户端（开发机回退）。联网装依赖后此回退不再生效。');
}

const PACKAGE_ID = 'dsh-mineru-plugin';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
mkdirSync(outDir, { recursive: true });

const result = await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  minify: true,
  write: false,
  // 这些由 dsh 的客户端模块图提供（__ModuleLoader__ require 解析），不能打进包里；
  // react* 同理：dsh 前端把自己的 react 作为静态模块共享给所有插件
  // （必须共用同一份 React，否则 hooks 在渲染器里拿不到 dispatcher 会直接崩溃）
  external: [
    '@deepseek-ai/dsh-client-runtime/client',
    '@deepseek-ai/dsh-client-ui-slots/client',
    '@deepseek-ai/dsh-client-ui-settings/client',
    '@deepseek-ai/dsh-client-locale/client',
    'react*',
  ],
  logLevel: 'info',
});

const code = result.outputFiles[0].text;
const wrapped = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(PACKAGE_ID)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${code}
		return module.exports;
	}
});
`;
writeFileSync('dist/client.js', wrapped);
console.log('dist/client.js 构建完成');
