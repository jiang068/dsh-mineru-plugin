# dsh-mineru-plugin

> **English** · [中文](README.md)

MinerU document/image-to-Markdown vision bridge for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness).

dsh models are text-only, so this plugin registers a native `mineru_read_image`
tool that turns a local image, PDF, screenshot, scan or Office file into
structured Markdown, powered by the official [MinerU](https://mineru.net) v4
API. It is the "eyes for a text-only model" — the vision/document bridge that
ModLens-style conversational multimodal providers don't cover for document-parse
use cases.

MinerU is a China-based service (Shanghai AI Lab / OpenDataLab) reached
directly over the public internet — no proxy needed.

---

## Why this plugin

- Most "reading" needs are about text-dense images: screenshots, chat records,
  scans, tables, forms, documents.
- MinerU's official API is production-ready and needs no self-hosting.
- MinerU is a **document parser, not a conversational multimodal model**, so it
  cannot be dropped into ModLens as a vision provider. Hence a dedicated dsh
  plugin that bridges MinerU to text-only dsh models.
- MinerU returns structured **Markdown** (with `$...$/$$...$$` LaTeX formulas,
  tables, headings) rather than the JSON evidence a conversational vision
  model returns — ideal for reading documents verbatim.

---

## Installation (in a running dsh profile)

```bash
# 1. put the plugin source anywhere, e.g. /opt/dsh-mineru-plugin
# 2. add it to the active profile's package.json (uses a local link), or install
#    from npm once published. Example for a local checkout:
cd "$DSH_HOME/profiles/<profile-name>"
#   add the dependency in package.json:
#     "dsh-mineru-plugin": "link:/opt/dsh-mineru-plugin"
#   and add "dsh-mineru-plugin" to dsh.profile.bundles
pnpm install
# 3. (optional) add config override to the profile's cordis.patch.yml:
#   - id: dsh-mineru-plugin
#     config:
#       apiKey: 'sk-...'
# 4. restart the dsh web service:
systemctl restart dsh-web
```

---

## Configuration (API key)

The plugin resolves the API key in this order (first hit wins):

1. `config.apiKey` — set it in the profile's `cordis.patch.yml`:
   ```yaml
   - id: dsh-mineru-plugin
     config:
       apiKey: 'sk-...'
   ```
2. `MINERU_API_KEY` environment variable.
3. `~/.mineru/config` file with `{"apiKey":"sk-..."}`.

**Never commit a real key.** The key is read at call time, so it can live
outside the repo (env, your profile's uncommitted patch layer, or a local
untracked config file).

> ⚠️ The root filesystem may be read-only (`mount` shows `ro`). Remount before
> writing to `/`-level paths: `sudo mount -o remount,rw /`.
---

## Settings panel (web settings card)

Included is a dsh **settings panel** card, listed under Settings → Plugins
(MinerU), to manage the API key and route:

- **API key**: shows "configured / unconfigured", lets you save a new key or
  clear it. The plaintext is never returned.
- **Route**: `auto` (default) / `v1` / `v4`.

The client is `dsh/client.js` (hand-written, zero-dependency; follows dsh's
official `settings.plugin.item` slot, same shape as @liustack/modlens). The
server `dsh/index.js` uses scoped `ctx.inject(['webServer'])` /
`ctx.inject(['settings'])` to provide `/api/dsh-mineru/config` and the settings
namespace; keys persist to `~/.mineru/config` (mode 0600).

**No esbuild build step**: `dsh/client.js` is served by dsh at
`/plugins/<package-name>/client.js`.


## Tool usage

### Signature

Registers a single native tool, `mineru_read_image` (rename via
`config.toolName`):

```json
{
  "mineru_read_image": {
    "path": "/absolute/path/xxx.png | https://...",
    "prompt": "optional, passed through verbatim (not sent to API)"
  }
}
```

- `path` is required and takes a local absolute path or an http(s) URL. When a
  URL is given, the plugin downloads it to a temp file before upload.
- The result object contains `fullMarkdown` (also `markdown`), `fileName`, and
  `fullZipUrl`.

### Example result

For a text+formula image, `fullMarkdown` looks like:

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

## How it works (v4 precise-parse API)

Flow implemented in [`dsh/index.js`](dsh/index.js):

```
1. POST /api/v4/file-urls/batch            -> {batch_id, file_urls[]}
2. PUT  file_urls[0] (raw bytes)            upload (no Content-Type)
3. GET  /api/v4/extract-results/batch/{batch_id}  poll until state=="done"
4. GET  full_zip_url  download zip -> read full.md
```

Notable implementation details:
- Uses **Node 22 built-in `fetch`** — only the standard library, no heavy
  dependencies.
- PUT upload must pass `duplex:'half'` + `Readable.toWeb(createReadStream(...))`
  or Node 22's fetch fails with `RequestInit: duplex option is required`.
- The result zip is parsed with Node's built-in `zlib.inflateRawSync` to extract
  `full.md` (no external unzip dependency).

### API models

| model_version | notes |
|---|---|
| `vlm` (recommended) | higher precision on text-dense scans |
| `pipeline` (default) | faster, lighter |
| `MinerU-HTML` | HTML dual output |

Limits (v4 precise parse): ≤ 200 MB / 200 pages / up to 200 files per batch,
~1000 high-priority pages per account per day.

Formats: png, jpg/jpeg, jp2, webp, gif, bmp, tiff, heic/heif + PDF/Office.

---

## Smoke test

```bash
node scripts/smoke-test.mjs /path/to/image-or-pdf [--key sk-...]
# or
MINERU_API_KEY=sk-... node scripts/smoke-test.mjs /path/to/sample.png
```

Verified end-to-end (2026-08-21):
- a text PNG → `"Hello MinerU API test 2026"`
- a PDF → `"Hello MinerU PDF test"`
- real zip's `full.md` extracted correctly
- a screenshot of control-theory math → full LaTeX reproduced verbatim

---

## Repo layout

```
dsh-mineru-plugin/
├── dsh/index.js            plugin code (registers mineru_read_image)
├── scripts/smoke-test.mjs  end-to-end smoke test
├── cordis.patch.yml        dsh bundle manifest (no secrets)
├── package.json            package manifest (name: dsh-mineru-plugin)
├── README.md               this file
└── LICENSE                  MIT
```

---

## Security notes

- the real API key and any personal identifiers are **never committed**;
  this repo is intentionally sanitized.
- On a shared/root machine, prefer keeping the key in an untracked profile
  patch layer, an env var, or `~/.mineru/config` rather than in a tracked file.
- MinerU is reached directly (China region); no proxy required for mineru.net.

---

## License

MIT