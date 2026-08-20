// DeepSeek Harness (dsh) plugin: registers a `mineru_read_image` native tool
// backed by the official MinerU v4 precise-parse API.
//
// MinerU (Shanghai AI Lab / OpenDataLab) turns local images, PDFs and Office
// files into structured Markdown/JSON. dsh models are text-only, so this tool
// is the vision/document bridge: unlike a prompt-triggered skill, a registered
// tool schema reaches the model on every request, so there is no trigger
// gamble. The same tool reads a QQ-dropped local image path, an http(s) URL,
// or a local PDF/docx, and returns the parsed `full.md` Markdown to the
// text-only model.
//
// Flow (v4 precise parse, token-based, verified 2026-08-21):
//   1. POST  /api/v4/file-urls/batch   -> {batch_id, file_urls[]} (signed OSS PUT urls)
//   2. PUT   file_urls[i]               raw bytes, NO Content-Type
//   3. GET   /api/v4/extract-results/batch/{batch_id}  poll until state=="done"
//   4. GET   full_zip_url               download zip -> read full.md
//
// mineru.net is a China-based service and this machine reaches it directly
// (no mihomo proxy). Configuration is resolved in this priority:
//   config.apiKey  →  process.env.MINERU_API_KEY  →  ~/.mineru/config
import { homedir, tmpdir } from 'node:os'
import { promises as fs, createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { inflateRawSync } from 'node:zlib'

export const name = 'dsh-mineru-plugin'
export const inject = ['tools']

const BASE_URL = 'https://mineru.net/api/v4'
const MAX_BYTES = 200 * 1024 * 1024 // v4 precise parse limit
const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 5 * 60 * 1000
const TOOL_TIMEOUT_MS = 8 * 60 * 1000

// Simpler PNG/JPEG sniff for the local-path sanity check; the MinerU API itself
// handles the full format matrix (png/jpg/jpeg/jp2/webp/gif/bmp + pdf/office).
function looksLikeSupportedFile(path) {
  const lower = String(path).toLowerCase()
  return /\.(png|jpe?g|jfif|jpeg|jp2|webp|gif|bmp|tiff?|heic|heif|pdf|docx?|pptx?|xlsx?|txt|md)$/i.test(lower)
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value).trim())
}

// --- Config resolution -----------------------------------------------------

async function readKeyConfig() {
  // ~/.mineru/config — shared JSON config, same spirit as ~/.modlens/config.json
  try {
    const text = await fs.readFile(join(homedir(), '.mineru', 'config'), 'utf8')
    const parsed = JSON.parse(text)
    return parsed.apiKey || parsed.token || null
  } catch {
    return null
  }
}

async function resolveApiKey(config = {}) {
  const fromConfig = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
  if (fromConfig) return fromConfig
  if (process.env.MINERU_API_KEY && process.env.MINERU_API_KEY.trim()) {
    return process.env.MINERU_API_KEY.trim()
  }
  const fromFile = await readKeyConfig()
  if (fromFile) return fromFile
  throw new Error(
    'MinerU API key not found. Set config.apiKey in the dsh profile cordis.patch.yml, ' +
      'the MINERU_API_KEY environment variable, or create ~/.mineru/config as ' +
      '{"apiKey":"sk-..."}',
  )
}

// --- HTTP helpers -----------------------------------------------------------

async function jsonFetch(url, options) {
  const res = await fetch(url, options)
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const detail = body?.msg || body?.error || text.slice(0, 300) || res.statusText
    throw new Error(`MinerU HTTP ${res.status}: ${detail}`)
  }
  return body
}

async function uploadRaw(presignedUrl, filePath) {
  const res = await fetch(presignedUrl, {
    method: 'PUT',
    // MinerU docs: do NOT set Content-Type; raw bytes only.
    // Node 22 fetch requires `duplex: 'half'` when the body is a stream.
    body: Readable.toWeb(createReadStream(filePath)),
    duplex: 'half',
    redirect: 'follow',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`MinerU upload failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return res
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// --- Core: parse one file to Markdown ---------------------------------------

async function parseFile(apiKey, filePath) {
  const fname = filePath.split('/').pop() || 'document'
  const dataId = `dsh-${Date.now()}`

  // 1. request batch upload urls
  const batch = await jsonFetch(`${BASE_URL}/file-urls/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      files: [{ name: fname, data_id: dataId }],
      model_version: 'vlm', // recommended for higher precision on text-dense scans
    }),
  })

  if (batch?.code !== 0 || !Array.isArray(batch?.data?.file_urls) || batch.data.file_urls.length === 0) {
    throw new Error(`MinerU batch request failed: ${JSON.stringify(batch).slice(0, 400)}`)
  }
  const batchId = batch.data.batch_id
  const uploadUrl = batch.data.file_urls[0]

  // 2. upload raw bytes
  await uploadRaw(uploadUrl, filePath)

  // 3. poll for completion
  const started = Date.now()
  let last = null
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const result = await jsonFetch(`${BASE_URL}/extract-results/batch/${batchId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const item = result?.data?.extract_result?.[0] ?? null
    last = item
    if (!item) {
      await delay(POLL_INTERVAL_MS)
      continue
    }
    const state = item.state
    if (state === 'done' && item.full_zip_url) {
      return { zipUrl: item.full_zip_url, fileName: item.file_name || fname, batchId }
    }
    if (state === 'failed') {
      throw new Error(`MinerU parse failed: ${item.err_msg || item.state}`)
    }
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(
    `MinerU parse timed out after ${POLL_TIMEOUT_MS / 1000}s. Last state: ${last?.state || 'unknown'}`,
  )
}

// --- Download zip and extract full.md ---------------------------------------

async function downloadFullMarkdown(zipUrl) {
  const res = await fetch(zipUrl, {
    headers: { Authorization: `Bearer ${process.env.MINERU_API_KEY || ''}` },
  })
  if (!res.ok) {
    throw new Error(`MinerU zip download failed (${res.status})`)
  }
  const buf = Buffer.from(await res.arrayBuffer())

  // Minimal in-memory zip reader for the common case: DEFLATE + STORE with
  // UTF-8/ASCII names, enough to pull out `full.md` without a native dep.
  const entries = readZipEntries(buf)
  const mdEntry =
    entries.find((e) => e.name === 'full.md') ||
    entries.find((e) => e.name.endsWith('/full.md')) ||
    entries.find((e) => /full\.md$/i.test(e.name))
  if (!mdEntry) {
    const names = entries.map((e) => e.name).slice(0, 20).join(', ')
    throw new Error(`MinerU zip has no full.md. Entries: ${names || 'none'}`)
  }
  return mdEntry.text
}

function readZipEntries(buf) {
  const total = buf.length
  // Find End of Central Directory (EOCD) signature 0x06054b50
  let eocd = -1
  for (let i = total - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP archive (no EOCD)')

  const cdCount = buf.readUInt16LE(eocd + 10) // total entries
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const entries = []
  let p = cdOffset
  for (let i = 0; i < cdCount; i++) {
    // central directory header signature 0x02014b50
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

    // Parse local file header to find where data starts
    const lfh = localOffset
    const lNameLen = buf.readUInt16LE(lfh + 26)
    const lExtraLen = buf.readUInt16LE(lfh + 28)
    const dataStart = lfh + 30 + lNameLen + lExtraLen
    const compData = buf.subarray(dataStart, dataStart + compSize)

    let content
    if (method === 0) {
      // stored
      content = compData
    } else if (method === 8) {
      // deflate
      content = inflateRaw(compData, uncompSize)
    } else {
      content = Buffer.from(`[unsupported zip method ${method}]`)
    }
    entries.push({ name, size: uncompSize, text: content.toString('utf8') })

    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function decodeZipName(raw) {
  // Try UTF-8 first, then latin-1 fallback.
  const utf8 = raw.toString('utf8')
  // crude check: re-encode to see if it round-trips
  if (Buffer.from(utf8, 'utf8').equals(raw)) return utf8
  return raw.toString('latin1')
}

function inflateRaw(data, expectedLen) {
  // Node's built-in zlib handles all deflate variants robustly.
  return inflateRawSync(data, { maxOutputLength: expectedLen + 1024 })
}

// --- Tool --------------------------------------------------------------------

function readImageTool(toolName, pluginConfig) {
  return {
    name: toolName,
    description:
      'Read an image, scanned page, screenshot, PDF or Office document through the official MinerU API and return its parsed text as structured Markdown. Use whenever a message references a local file path or http(s) URL to an image/PDF/doc you need to read or transcribe (screenshots, photos, chat records, scans, tables, forms, slides). Returns the full parsed Markdown (headings, paragraphs, tables, formulas preserved); quote the returned text instead of guessing. Requires a configured MinerU API key.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute local file path (e.g. /path/to/xxx.png) or an http(s) URL of the image/PDF/document to read.',
        },
        prompt: {
          type: 'string',
          description:
            'Optional free-text instruction for the caller/reader focus (e.g. "transcribe all text", "extract the table as CSV"). MinerU parses structure; this hint is passed through for clarity and is not sent to the API.',
        },
      },
      required: ['path'],
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: toolName,
      kind: 'read',
      rawInput: args,
      ...(typeof args?.path === 'string' && !isHttpUrl(args.path)
        ? { locations: [{ path: args.path }] }
        : {}),
    }),
    async execute(args, exec) {
      if (typeof args?.path !== 'string' || args.path.trim() === '') {
        throw new Error(`${toolName} needs a non-empty string "path".`)
      }
      const path = args.path.trim()

      let filePath
      let cleanupTemp = null
      if (isHttpUrl(path)) {
        // Remote URL: download to a temp file, then upload to MinerU as though local.
        const tmpDir = `${ssrTmp()}/dsh-mineru-${Date.now()}`
        await fs.mkdir(tmpDir, { recursive: true })
        const name = new URL(path).pathname.split('/').pop() || 'remote-doc'
        filePath = join(tmpDir, name)
        const res = await fetch(path)
        if (!res.ok) throw new Error(`Failed to download ${path} (${res.status})`)
        const bytes = Buffer.from(await res.arrayBuffer())
        await fs.writeFile(filePath, bytes)
        cleanupTemp = async () => {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
        }
      } else {
        if (!existsSync(path)) {
          throw new Error(`${toolName}: file not found: ${path}`)
        }
        if (!looksLikeSupportedFile(path)) {
          throw new Error(
            `${toolName}: unsupported file type for "${path}". MinerU supports png/jpg/jpeg/jp2/webp/gif/bmp/tiff/heic/heif, PDF and Office docs.`,
          )
        }
        const stat = await fs.stat(path)
        if (stat.size > MAX_BYTES) {
          throw new Error(`${toolName}: file too large (${stat.size} bytes, limit ${MAX_BYTES}).`)
        }
        filePath = path
      }

      try {
        const apiKey = await resolveApiKey(pluginConfig)
        const { zipUrl, fileName } = await parseFile(apiKey, filePath)
        let markdown
        try {
          markdown = await downloadFullMarkdown(zipUrl)
        } catch (e) {
          // fall back to just reporting the zip url so the model can still act
          return {
            summary: `Parsed ${fileName} via MinerU. Zip download failed, but here is what happened: ${e.message}`,
            fileName,
            fullZipUrl: zipUrl,
          }
        }
        return {
          summary: `Parsed ${fileName} via MinerU. Full Markdown below.`,
          fileName,
          fullMarkdown: markdown,
          // keep raw text also under the common `markdown` key for flexibility
          markdown,
          fullZipUrl: zipUrl,
          ...(args.prompt ? { prompt: args.prompt } : {}),
        }
      } finally {
        if (cleanupTemp) await cleanupTemp()
      }
    },
  }
}

function ssrTmp() {
  return tmpdir()
}

export function apply(ctx, config = {}) {
  const toolName = config.toolName || 'mineru_read_image'
  try {
    ctx.tools.register(readImageTool(toolName, config))
  } catch (error) {
    console.error(`[dsh-mineru-plugin] ${toolName} registration skipped: ${error}`)
  }
}
