# dsh-mineru-plugin

> **中文** · [English](README_en.md)

MinerU 文档/图片 → Markdown 视觉桥接插件,面向 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness)。

dsh 的模型是纯文本的,本插件注册一个原生工具 `mineru_read_image`,把本地图片、
PDF、截图、扫描件或 Office 文件**解析成结构化 Markdown**,由官方 [MinerU](https://mineru.net)
v4 API 驱动。它是"纯文本模型的眼镜/文档桥"——覆盖了 ModLens 类对话式多模态
provider 不做文档解析的场景。

MinerU 是国内服务(上海AI实验室 / OpenDataLab),通过公网**直连**即可,无需代理。

---

## 为什么需要这个插件

- 绝大多数"读图"需求是文字密集图片:截图、聊天记录、扫描件、表格、表单、文档。
- MinerU 官方 API 生产可用,无需自建。
- MinerU 是**文档解析器,不是对话式多模态模型**,所以不能塞进 ModLens 当 vision
  provider。因此自写一个专供 MinerU 的 dsh 插件,把它桥接到纯文本的 dsh 模型。
- MinerU 返回结构化 **Markdown**(含 `$...$/$$...$$` LaTeX 公式、表格、标题),
  而非对话式视觉模型返回的 JSON 证据——非常适合逐字读取文档。

---

## 安装(在运行中的 dsh profile 里)

```bash
# 1. 把插件源码放在任意位置,例如 /opt/dsh-mineru-plugin
# 2. 加入当前 profile 的 package.json(用本地 link),或发布到 npm 后安装。本地示例:
cd "$DSH_HOME/profiles/<profile-name>"
#   package.json 添加依赖:
#     "dsh-mineru-plugin": "link:/opt/dsh-mineru-plugin"
#   dsh.profile.bundles 添加 "dsh-mineru-plugin"
pnpm install
# 3. (可选)在 profile 的 cordis.patch.yml 加配置覆盖:
#   - id: dsh-mineru-plugin
#     config:
#       apiKey: 'sk-...'
# 4. 重启 dsh web 服务:
systemctl restart dsh-web
```

---

## 配置(API key)

插件按以下顺序解析 API key(取第一个命中的):

1. `config.apiKey` — 在 profile 的 `cordis.patch.yml` 设置:
   ```yaml
   - id: dsh-mineru-plugin
     config:
       apiKey: 'sk-...'
   ```
2. 环境变量 `MINERU_API_KEY`。
3. `~/.mineru/config` 文件,内容 `{"apiKey":"sk-..."}`。

**绝对不要把真实 key 提交进仓库。** key 在运行时读取,可以放在仓库之外
(环境变量、profile 未提交的 patch 层、或本地的未跟踪配置文件)。

> ⚠️ 根文件系统可能是只读的(`mount` 显示 `ro`)。写入 `/` 级路径前先 remount:
> `sudo mount -o remount,rw /`。

---

## 设置面板(网页设置卡片)

插件带一个 dsh **设置面板**(网页设置 → 插件 / MinerU 分区),可设置 API key 与路由:

- **API key**:查看"已配置/未配置",输入新 key 保存或一键清除。明文不回显。
- **路由**:`auto`(默认)/ `v1` / `v4`。

前端(`src/client/*`)+ 后端路由(`/api/dsh-mineru/config`,由 `dsh/index.js` 的
webServer 提供)配合工作,key 持久化到 `~/.mineru/config`(权限 0600)。

构建前端:先 `pnpm add -D esbuild`(开发机可回退用已有 esbuild),再
```bash
pnpm run build:client
```
产物为 `dist/client.js`,由 dsh 经 `/plugins/dsh-mineru-plugin/client.js` 分发。

---

## 双 API 智能路由

注册一个工具 `mineru_read_image`,带 `output` 参数(`markdown` 默认 / `latex` / `html`)。

路由逻辑:
- **小 markdown 任务**(文件 ≤10MB、≤20页、output=markdown)→ 优先走 **v1**
  (免费、无需 token)。若 v1 撞到 IP 限频(429)则降级 v4。
- **latex / html 输出** → 走 **v4**(v1 仅 markdown),自动加
  `extra_formats=["latex"|"html"]`。
- **无 token + latex/html** → 清晰报错,提示需 key(或改用小文件 markdown,
  v1 可无 key 处理)。

v1 agent API **无需 token**(本地文件):`POST /api/v1/agent/parse/file`
→ PUT 签名 URL → `GET /api/v1/agent/parse/{task_id}` → `markdown_url`。
v4 需 token(见配置),从结果 zip 提取 `full.md` / `full.tex` / `full.html`。

---

## 工具用法

### 签名

注册单个原生工具 `mineru_read_image`(可通过 `config.toolName` 改名):

```json
{
  "mineru_read_image": {
    "path": "/绝对/路径/xxx.png | https://...",
    "prompt": "可选,原样透传(不发给 API)"
  }
}
```

- `path` 必填,接受本地绝对路径或 http(s) URL。若传 URL,插件会先下载到临时文件再上传。
- 返回对象含 `fullMarkdown`(亦为 `markdown`)、`fileName`、`fullZipUrl`。

### 返回示例

对一张"文字+公式"图片,`fullMarkdown` 形如:

```latex
若直接采用真实状态进行状态反馈（$u = r - kx$），闭环系统为：

$$
\dot{\pmb{x}} = (\pmb{A} - \pmb{bk})\pmb{x} + \pmb{b}r, \quad y = \pmb{cx}\tag{95}
$$

对应的直接状态反馈闭环传递函数为:

$$
G_{yr,\mathrm{direct}}(s) = \pmb{c}[s I - (\pmb{A} - \pmb{bk})]^{-1}\pmb{b}\tag{96}
$$

两式完全相同，即 $G_{yr}(s) \equiv G_{yr,\mathrm{direct}}(s)$。
```

---

## 工作原理(v4 精准解析 API)

实现在 [`dsh/index.js`](dsh/index.js):

```
1. POST /api/v4/file-urls/batch            -> {batch_id, file_urls[]}
2. PUT  file_urls[0](原始字节)             上传(不设 Content-Type)
3. GET  /api/v4/extract-results/batch/{batch_id}  轮询直到 state=="done"
4. GET  full_zip_url  下载 zip -> 读取 full.md
```

实现细节:
- 用 **Node 22 内置 `fetch`** —— 只用标准库,无重型依赖。
- PUT 上传必须传 `duplex:'half'` + `Readable.toWeb(createReadStream(...))`,
  否则 Node 22 的 fetch 会报 `RequestInit: duplex option is required`。
- 结果 zip 用 Node 内置 `zlib.inflateRawSync` 解析出 `full.md`(不依赖外部 unzip)。

### API 模型

| model_version | 说明 |
|---|---|
| `vlm`(推荐) | 对文字密集扫描件精度更高 |
| `pipeline`(默认) | 更快、更轻 |
| `MinerU-HTML` | 附带 HTML 双输出 |

限制(v4 精准解析):≤ 200 MB / 200 页 / 单批 ≤200 个文件,每账号每天约 1000 页高优先级。

支持的格式:png、jpg/jpeg、jp2、webp、gif、bmp、tiff、heic/heif + PDF/Office。

---

## 冒烟测试

```bash
node scripts/smoke-test.mjs /path/to/image-or-pdf [--key sk-...]
# 或
MINERU_API_KEY=sk-... node scripts/smoke-test.mjs /path/to/sample.png
```

2026-08-21 已端到端验证:
- 文字 PNG → `"Hello MinerU API test 2026"`
- PDF → `"Hello MinerU PDF test"`
- 真实 zip 的 `full.md` 正确解出
- 控制理论公式截图 → LaTeX 公式逐字复刻

---

## 仓库结构

```
dsh-mineru-plugin/
├── dsh/index.js           插件代码(注册 mineru_read_image)
├── scripts/smoke-test.mjs 端到端冒烟测试
├── cordis.patch.yml       dsh bundle 清单(无密钥)
├── package.json           包清单(名称: dsh-mineru-plugin)
├── README.md              中文说明(默认)
├── README_en.md           英文说明
└── LICENSE                MIT
```

---

## 安全说明

- 真实 API key 及任何个人标识**永不提交**;本仓库有意脱敏。
- 在共享/root 机器上,更推荐把 key 放在未跟踪的 profile patch 层、环境变量或
  `~/.mineru/config`,而不是放进被跟踪的文件。
- MinerU 直连访问(国内区域);访问 mineru.net 无需代理。

---

## 许可证

MIT
