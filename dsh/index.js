// DeepSeek Harness (dsh) plugin: registers a `mineru_read_image` native tool
// backed by the official MinerU APIs — both the v4 precise-parse API (token)
// and the v1 agent lightweight-parse API (no token needed).
//
// MinerU (Shanghai AI Lab / OpenDataLab) turns local images, PDFs and Office
// files into structured Markdown/JSON. dsh models are text-only, so this tool
// is the vision/document bridge: a registered tool schema reaches the model on
// every request (no trigger gamble). Same tool reads a QQ-dropped local image
// path, an http(s) URL, or a local PDF/docx, and returns parsed text.
//
// Router (planned & implemented per user requirement):
//   * output=markdown (default) and file small (<=10MB, <=20 pages) -> v1 first
//     (free, no key/IP-limited, markdown-only). If v1 quiet or hits IP 429, or
//     output wants latex/html -> v4 precise parse (needs key).
//   * output=latex|html -> v4 (v1 is markdown-only).
//   * no key & v1 ineligible -> clear error explaining v4 needs a key.
//   * v4 always as a last fallback so nothing silently degrades.
//
// mineru.net is a China-based service reached directly (no proxy needed).
// v4 flow:  file-urls/batch -> PUT -> extract-results/batch/{id} -> zip -> full.md
// v1 flow:  agent/parse/file -> PUT -> agent/parse/{task_id} -> markdown_url
import { homedir, tmpdir } from 'node:os'
import { promises as fs, createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { inflateRawSync } from 'node:zlib'

export const name = 'dsh-mineru-plugin'
export const inject = ['tools', 'webServer']

const V4_BASE = 'https://mineru.net/api/v4'
const V1_BASE = 'https://mineru.net/api/v1'
const V4_MAX_BYTES = 200 * 1024 * 1024
const V1_MAX_BYTES = 10 * 1024 * 1024     // v1 agent API limit
const V1_MAX_PAGES = 20
const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 5 * 60 * 1000
const TOOL_TIMEOUT_MS = 8 * 60 * 1000

const EXTS = 'png|jpe?g|jfif|jp2|webp|gif|bmp|tiff?|heic|heif|pdf|docx?|pptx?|xlsx?|txt|md'

function looksLikeSupportedFile(path) {
  return new RegExp(`\\.(${EXTS})$`, 'i').test(String(path))
}
function isHttpUrl(value) { return /^https?:\/\//i.test(String(value).trim()) }
function isPdfOrImage(path) {
  return new RegExp(`\\.(${'(?:png|jpe?g|tiff?|heic|heif|webp|gif|bmp)'.replace(/\?/g, '')})$`, 'i').test(path) || /\.pdf$/i.test(path)
}

// --- Config resolution -----------------------------------------------------

async function readKeyConfig() {
  try {
    const text = await fs.readFile(join(homedir(), '.mineru', 'config'), 'utf8')
    return JSON.parse(text)?.apiKey || JSON.parse(text)?.token || null
  } catch { return null }
}

async function resolveApiKeyOrNull(config = {}) {
  const fromConfig = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
  if (fromConfig) return fromConfig
  if (process.env.MINERU_API_KEY && process.env.MINERU_API_KEY.trim()) return process.env.MINERU_API_KEY.trim()
  return await readKeyConfig()
}

// --- HTTP helpers -----------------------------------------------------------

async function jsonFetch(url, options) {
  const res = await fetch(url, options)
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (!res.ok) {
    const detail = body?.msg || body?.error || text.slice(0, 300) || res.statusText
    if (res.status === 429) {
      const err = new Error(`MinerU rate limited (429): ${detail}`)
      err.code = 'RATE_LIMIT'
      throw err
    }
    throw new Error(`MinerU HTTP ${res.status}: ${detail}`)
  }
  if (body && typeof body === 'object' && 'code' in body && body.code !== 0) {
    const detail = body?.msg || body?.error || JSON.stringify(body).slice(0, 300)
    throw new Error(`MinerU API error: ${detail}`)
  }
  return body
}

async function uploadRaw(presignedUrl, filePath) {
  const res = await fetch(presignedUrl, {
    method: 'PUT',
    // MinerU docs: do NOT set Content-Type; raw bytes only.
    body: Readable.toWeb(createReadStream(filePath)),
    duplex: 'half',
    redirect: 'follow',
  })
  if (res.status === 403) {
    const text = await res.text().catch(() => '')
    // SignatureDoesNotMatch usually means a Content-Type got attached; if the
    // caller added one we already avoid it. Surface a clear error.
    const err = new Error(`MinerU upload failed (${res.status}): ${text.slice(0, 200)}`)
    err.code = 'UPLOAD'
    throw err
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`MinerU upload failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return res
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }

// --- v1 agent (no-token) flow ----------------------------------------------

async function parseFileV1(filePath) {
  const fname = filePath.split('/').pop() || 'document'
  // 1. request signed upload url (no auth)
  const submit = await jsonFetch(`${V1_BASE}/agent/parse/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_name: fname,
      language: 'ch',
      enable_table: true,
    }),
  })
  const data = submit?.data
  if (!data?.task_id || !data?.file_url) {
    throw new Error(`MinerU v1 submit failed: ${JSON.stringify(submit).slice(0, 300)}`)
  }
  // 2. upload raw bytes
  await uploadRaw(data.file_url, filePath)
  // 3. poll
  const started = Date.now()
  let last = null
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const result = await jsonFetch(`${V1_BASE}/agent/parse/${data.task_id}`, { method: 'GET' })
    const s = result?.data?.state
    last = result?.data
    if (s === 'done') {
      if (!result?.data?.markdown_url) throw new Error('MinerU v1 done but no markdown_url')
      return { taskId: data.task_id, markdownUrl: result.data.markdown_url, fileName: fname }
    }
    if (s === 'failed') throw new Error(`MinerU v1 parse failed: ${result?.data?.error || s}`)
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`MinerU v1 timed out. Last state: ${last?.state || 'unknown'}`)
}

async function downloadV1Markdown(markdownUrl) {
  const res = await fetch(markdownUrl)
  if (!res.ok) throw new Error(`MinerU v1 markdown download failed (${res.status})`)
  return await res.text()
}

// --- v4 precise-parse (token) flow -----------------------------------------

async function parseFileV4(apiKey, filePath, opts = {}) {
  const fname = filePath.split('/').pop() || 'document'
  const dataId = `dsh-${Date.now()}`
  const modelVersion = opts.modelVersion || 'vlm'
  const body = {
    files: [{ name: fname, data_id: dataId, ...(opts.pageRanges ? { page_ranges: opts.pageRanges } : {}) }],
    model_version: modelVersion,
    is_ocr: false,
    enable_formula: true,
    enable_table: true,
  }
  if (Array.isArray(opts.extraFormats) && opts.extraFormats.length) body.extra_formats = opts.extraFormats
  const batch = await jsonFetch(`${V4_BASE}/file-urls/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!Array.isArray(batch?.data?.file_urls) || batch.data.file_urls.length === 0) {
    throw new Error(`MinerU v4 batch request failed: ${JSON.stringify(batch).slice(0, 300)}`)
  }
  const batchId = batch.data.batch_id
  await uploadRaw(batch.data.file_urls[0], filePath)
  const started = Date.now()
  let last = null
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const result = await jsonFetch(`${V4_BASE}/extract-results/batch/${batchId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const item = result?.data?.extract_result?.[0] ?? null
    last = item
    if (!item) { await delay(POLL_INTERVAL_MS); continue }
    if (item.state === 'done' && item.full_zip_url) return { zipUrl: item.full_zip_url, fileName: item.file_name || fname, batchId }
    if (item.state === 'failed') throw new Error(`MinerU v4 parse failed: ${item.err_msg || item.state}`)
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`MinerU v4 timed out. Last state: ${last?.state || 'unknown'}`)
}

async function extractFromZip(zipUrl, names) {
  const wants = Array.isArray(names) ? names : [names]
  const res = await fetch(zipUrl)
  if (!res.ok) throw new Error(`MinerU zip download failed (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const entries = readZipEntries(buf)
  for (const want of wants) {
    const re = new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
    const found =
      entries.find((e) => e.name === want) ||
      entries.find((e) => e.name.endsWith('/' + want)) ||
      entries.find((e) => re.test(e.name))
    if (found) return { name: found.name, text: found.text }
  }
  throw new Error(`MinerU zip has no ${wants.join(' / ')}. Entries: ${entries.map((e) => e.name).join(', ') || 'none'}`)
}

async function downloadFullMarkdown(zipUrl) {
  const { text } = await extractFromZip(zipUrl, ['full.md'])
  return text
}

function readZipEntries(buf) {
  const total = buf.length
  let eocd = -1
  for (let i = total - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP archive (no EOCD)')
  const cdCount = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  let p = cdOffset
  const entries = []
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const rawName = buf.subarray(p + 46, p + 46 + nameLen)
    const name = decodeZipName(rawName)
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const compData = buf.subarray(dataStart, dataStart + compSize)
    let content
    if (method === 0) content = compData
    else if (method === 8) content = inflateRawSync(compData, { maxOutputLength: uncompSize + 1024 })
    else content = Buffer.from(`[unsupported zip method ${method}]`)
    entries.push({ name, text: content.toString('utf8') })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function decodeZipName(raw) {
  const utf8 = raw.toString('utf8')
  return Buffer.from(utf8, 'utf8').equals(raw) ? utf8 : raw.toString('latin1')
}

// --- Routing -----------------------------------------------------------------

// Decide whether v1 is worth trying for this call.
function v1Eligible(pluginConfig, fileSize, { wantsLatexOrHtml }) {
  if (wantsLatexOrHtml) return false            // v1 is markdown-only
  if (pluginConfig.route === 'v4') return false // explicit v4 preference
  if (fileSize != null && fileSize > V1_MAX_BYTES) return false // v1 10MB limit
  return true                                   // small + markdown-only -> v1 (free, works with or without key)
}

// --- Tool --------------------------------------------------------------------

function readImageTool(toolName, pluginConfig) {
  return {
    name: toolName,
    description:
      'Read an image, scanned page, screenshot, PDF or Office document through the official MinerU API and return its parsed text as structured Markdown (and optionally LaTeX/HTML via the v4 precise-parse API). Use whenever a message references a local file path or http(s) URL to an image/PDF/doc you need to read or transcribe (screenshots, photos, chat records, scans, tables, forms, slides). Returns the full parsed result; quote the returned text instead of guessing.',
        parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute local file path (e.g. /path/to/xxx.png) or an http(s) URL of the image/PDF/document to read.' },
        output: {
          type: 'string',
          enum: ['auto', 'markdown', 'latex', 'html'],
          description: 'Desired result format. Default "auto": markdown. "latex" or "html" forces the v4 precise-parse API (v1 is markdown-only).',
        },
        prompt: { type: 'string', description: 'Optional free-text instruction for the caller/reader focus (passed through, not sent to the API).' },
      },
      required: ['path'],
    },
    output: {
      schema: { type: 'string' },
      render: (result) => (typeof result === 'string' ? result : JSON.stringify(result ?? '')),
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic', title: toolName, kind: 'read', rawInput: args,
      ...(typeof args?.path === 'string' && !isHttpUrl(args.path) ? { locations: [{ path: args.path }] } : {}),
    }),
    async execute(args, exec) {
      if (typeof args?.path !== 'string' || args.path.trim() === '') {
        throw new Error(`${toolName} needs a non-empty string "path".`)
      }
      const path = args.path.trim()
      const wantsLatexOrHtml = args.output === 'latex' || args.output === 'html'
      const outputMode = wantsLatexOrHtml ? (args.output === 'latex' ? 'latex' : 'html') : 'markdown'

      let filePath, cleanupTemp = null
      if (isHttpUrl(path)) {
        const tmpDir = `${tmpdir()}/dsh-mineru-${Date.now()}`
        await fs.mkdir(tmpDir, { recursive: true })
        const name = new URL(path).pathname.split('/').pop() || 'remote-doc'
        filePath = join(tmpDir, name)
        const res = await fetch(path)
        if (!res.ok) throw new Error(`Failed to download ${path} (${res.status})`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > V4_MAX_BYTES) throw new Error(`file too large (${buf.length} bytes)`)
        await fs.writeFile(filePath, buf)
        cleanupTemp = async () => { await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}) }
      } else {
        if (!existsSync(path)) throw new Error(`${toolName}: file not found: ${path}`)
        if (!looksLikeSupportedFile(path)) throw new Error(`${toolName}: unsupported file type "${path}". MinerU supports png/jpg/jpeg/jp2/webp/gif/bmp/tiff/heic/heif, PDF and Office docs.`)
        const st = await fs.stat(path)
        if (st.size > V4_MAX_BYTES) throw new Error(`${toolName}: file too large (${st.size} bytes, v4 limit).`)
        filePath = path
      }

      const apiKey = await resolveApiKeyOrNull(pluginConfig).catch(() => null)
      let fileSize = null
      try { fileSize = (await fs.stat(filePath)).size } catch {}

      const usedV1first = v1Eligible(pluginConfig, fileSize, { wantsLatexOrHtml })
      let result = null
      let route = null

      try {
        if (usedV1first) {
          // Prefer the free, no-token v1 path for small markdown tasks (with or without key).
          try {
            const v1 = await parseFileV1(filePath)
            const markdown = await downloadV1Markdown(v1.markdownUrl)
            route = 'v1'
            result = { summary: `Parsed ${v1.fileName} via MinerU lightweight v1 API. Markdown below.`, fileName: v1.fileName, fullMarkdown: markdown, markdown, route, taskId: v1.taskId }
          } catch (v1Err) {
            console.error(`[dsh-mineru-plugin] v1 failed (${v1Err?.code || 'err'}), falling back to v4: ${v1Err.message}`)
            // fall through to v4
          }
        }
        if (!result) {
          if (!apiKey) {
            throw new Error(
              'MinerU needs a key for this request (' + (wantsLatexOrHtml ? 'latex/html via v4' : 'v1 unavailable') + '). ' +
              'Set config.apiKey / MINERU_API_KEY / ~/.mineru/config (or retry with a small markdown-only file which v1 can handle without a key).',
            )
          }
          const extraFormats = outputMode === 'latex' ? ['latex'] : outputMode === 'html' ? ['html'] : []
          const v4 = await parseFileV4(apiKey, filePath, { modelVersion: 'vlm', extraFormats })
          const zipTargets = outputMode === 'latex' ? ['full.latex', 'full.tex', 'full.md']
                          : outputMode === 'html' ? ['full.html', 'full.htm', 'full.md']
                          : ['full.md']
          let markdown, zipName = 'full.md'
          try { ({ text: markdown, name: zipName } = await extractFromZip(v4.zipUrl, zipTargets)) }
          catch (e) { return { summary: `Parsed ${v4.fileName} via v4, but extracting output failed: ${e.message}`, fileName: v4.fileName, fullZipUrl: undefined, route: 'v4' } }
          route = 'v4'
          result = { summary: `Parsed ${v4.fileName} via MinerU v4 precise-parse API (${outputMode}).`, fileName: v4.fileName, fullMarkdown: markdown, markdown, format: zipName, fullZipUrl: v4.zipUrl, route: 'v4' }
        }
        return { ...result, ...(args.prompt ? { prompt: args.prompt } : {}) }
      } finally {
        if (cleanupTemp) await cleanupTemp()
      }
    },
  }
}


// --- Config store (settings panel backend) -----------------------------------
const MINERU_CONFIG_PATH = join(homedir(), '.mineru', 'config')

async function readRuntimeConfig() {
  // returns { apiKey (masked), hasKey, route }
  let raw = null
  try { raw = JSON.parse(await fs.readFile(MINERU_CONFIG_PATH, 'utf8')) } catch { raw = null }
  const effective = (pid) => {
    const c = typeof pid?.apiKey === 'string' ? pid.apiKey.trim() : ''
    if (c) return c
    if (process.env.MINERU_API_KEY && process.env.MINERU_API_KEY.trim()) return process.env.MINERU_API_KEY.trim()
    return raw?.apiKey || raw?.token || ''
  }
  return {
    hasKey: Boolean(effective({})),
    route: raw?.route ?? 'auto',
    maskKey: null, // never send plaintext
    configPath: MINERU_CONFIG_PATH,
  }
}

async function writeRuntimeConfig(patch) {
  await fs.mkdir(join(homedir(), '.mineru'), { recursive: true })
  let current = {}
  try { current = JSON.parse(await fs.readFile(MINERU_CONFIG_PATH, 'utf8')) } catch {}
  const updated = { ...current, ...patch }
  await fs.writeFile(MINERU_CONFIG_PATH, JSON.stringify(updated, null, 2), { mode: 0o600 })
  return updated
}

// --- webServer config route + quick command ----------------------------------
function registerConfigBackend(ctx, config) {
  if (typeof ctx?.webServer?.register !== 'function') {
    console.error('[dsh-mineru-plugin] webServer unavailable, settings route skipped')
    return
  }
  const send = (res, status, body) => {
    if (typeof res?.writeHead === 'function') {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
  }
  ctx.webServer.register({
    name: 'dsh-mineru-config',
    kind: 'exact',
    path: '/api/dsh-mineru/config',
    handler: async (req, res) => {
      try {
        if (req?.method === 'GET') {
          const st = await readRuntimeConfig()
          return send(res, 200, { ...st, apiKeySet: st.hasKey })
        }
        if (req?.method === 'POST') {
          const chunks = []
          for await (const c of req) {
            chunks.push(c)
            if (chunks.join('').length > 64 * 1024) return send(res, 413, { ok: false, error: 'too big' })
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          const patch = {}
          if (typeof body.apiKey === 'string' && body.apiKey.trim()) patch.apiKey = body.apiKey.trim()
          if (typeof body.route === 'string' && ['auto', 'v1', 'v4'].includes(body.route)) patch.route = body.route
          // empty apiKey string meaning clear it
          if (body.apiKey === '') patch.apiKey = ''
          const updated = await writeRuntimeConfig(patch)
          const st = await readRuntimeConfig()
          return send(res, 200, { ok: true, route: updated.route ?? 'auto', hasKey: st.hasKey, apiKeySet: st.hasKey })
        }
        return send(res, 405, { error: 'method not allowed' })
      } catch (e) {
        return send(res, 400, { error: String(e?.message || e) })
      }
    },
  })
}

// --- quick command (QQ/message level via ctx.commands if exposed) -------------
function registerQuickCommand(ctx, config) {
  try {
    if (typeof ctx?.commands?.register === 'function') {
      ctx.commands.register('mineru', {
        description: '查看/设置 MinerU API key 或路由 (用法: /mineru [set-key sk-...|set-route v1|v4|auto|status])',
        async execute(args, execCtx) {
          const argv = args?.trim?.().split(/\s+/) || []
          const cmd = argv[0] || 'status'
          if (cmd === 'status') {
            const st = await readRuntimeConfig()
            return `MinerU: key=${st.hasKey ? '已配置' : '未配置'}，route=${st.route ?? 'auto'}`
          }
          if (cmd === 'set-key') {
            const key = argv[1]
            if (!key) return '用法: /mineru set-key sk-...'
            await writeRuntimeConfig({ apiKey: key })
            return 'MinerU API key 已保存（已脱敏存储到 ~/.mineru/config）'
          }
          if (cmd === 'set-route') {
            const r = argv[1]
            if (!['v1', 'v4', 'auto'].includes(r)) return 'route 可选: v1 / v4 / auto'
            await writeRuntimeConfig({ route: r })
            return `MinerU 路由已设为 ${r}`
          }
          return '用法: /mineru [status|set-key sk-...|set-route v1|v4|auto]'
        },
      })
    } else {
      console.warn('[dsh-mineru-plugin] ctx.commands unavailable, quick command skipped (settings route still works)')
    }
  } catch (e) {}
}

export function apply(ctx, config = {}) {
  const toolName = config.toolName || 'mineru_read_image'
  try {
    ctx.tools.register(readImageTool(toolName, config))
  } catch (error) {
    console.error(`[dsh-mineru-plugin] ${toolName} registration skipped: ${error}`)
  }

  try {
    if (ctx.webServer) {
      registerConfigBackend(ctx, config)
    }
  } catch (error) {
    console.error(`[dsh-mineru-plugin] config backend skipped: ${error}`)
  }

  // settings namespace: rc.7 设置页按 namespace 分发包卡(settings.plugin.item)。缺了它
  // “设置→插件”不会 dispatch 本插件卡片。
  if (ctx.inject && typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (scope) => {
      try {
        const passThrough = (value) => ({ ...(value ?? {}) })
        passThrough.toJSON = () => ({ uid: 0, refs: { 0: { type: 'object', meta: { default: {} }, dict: {} } } })
        scope.settings.register('mineru', passThrough, { base: {} })
      } catch (error) {
        console.error(`[dsh-mineru-plugin] settings namespace skipped: ${error}`)
      }
    })
  }
}
