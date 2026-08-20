#!/usr/bin/env node
// End-to-end smoke test for the dsh-mineru plugin's core flow against the real
// MinerU v4 API. Creates a tiny PNG with text, uploads it, polls, downloads the
// zip and prints the parsed full.md. Uses the same request sequence as dsh/index.js.
//
// Usage:
//   node scripts/smoke-test.mjs [path-to-image-or-pdf] [--key sk-...]
// If no file is given, a tiny test PNG is generated in /tmp.
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inflateRawSync } from 'node:zlib'

const BASE_URL = 'https://mineru.net/api/v4'
const KEY = process.env.MINERU_API_KEY || process.argv[process.argv.indexOf('--key') + 1]
const POLL_INTERVAL_MS = 5000

if (!KEY) {
  console.error('No API key. Set MINERU_API_KEY or pass --key sk-...')
  process.exit(1)
}

let filePath = process.argv[2]
if (!filePath) {
  filePath = join(await imageFromHere(), 'hello-mineru.png')
}

async function makeTestPng() {
  const dir = mkdtempSync(join(tmpdir(), 'mineru-smoke-'))
  // Minimal valid PNG: 1x1 red pixel (transparent-ish) — mineru will parse it;
  // content is minimal but the flow (upload -> parse -> zip) is exercised.
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082',
    'hex',
  )
  writeFileSync(join(dir, 'hello-mineru.png'), png)
  return dir
}

async function imageFromHere() {
  return makeTestPng()
}

async function jsonFetch(url, options) {
  const res = await fetch(url, options)
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  return body
}

async function main() {
  console.log(`[1] Requesting upload URL for ${filePath} ...`)
  const name = filePath.split('/').pop()
  const batch = await jsonFetch(`${BASE_URL}/file-urls/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ files: [{ name, data_id: `smoke-${Date.now()}` }], model_version: 'vlm' }),
  })
  if (batch?.code !== 0) throw new Error(JSON.stringify(batch).slice(0, 400))
  const { batch_id, file_urls } = batch.data
  console.log(`   batch_id=${batch_id}`)

  console.log('[2] Uploading raw bytes ...')
  const up = await fetch(file_urls[0], { method: 'PUT', body: readFileSync(filePath) })
  if (!up.ok) throw new Error(`upload failed ${up.status}`)
  console.log('   upload OK')

  console.log('[3] Polling result ...')
  let item = null
  for (let i = 0; i < 60; i++) {
    const res = await jsonFetch(`${BASE_URL}/extract-results/batch/${batch_id}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    })
    item = res?.data?.extract_result?.[0] || null
    if (!item) { await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS)); continue }
    console.log(`   state=${item.state}`)
    if (item.state === 'done' && item.full_zip_url) break
    if (item.state === 'failed') throw new Error(`parse failed: ${item.err_msg}`)
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  if (!item?.full_zip_url) throw new Error('timed out')
  console.log(`   full_zip_url=${item.full_zip_url}`)

  console.log('[4] Downloading zip and extracting full.md ...')
  const zipRes = await fetch(item.full_zip_url)
  const buf = Buffer.from(await zipRes.arrayBuffer())
  const md = extractFullMd(buf)
  console.log('--- full.md ---')
  console.log(md.slice(0, 2000))
  console.log('--- smoke test PASSED ---')
}

function extractFullMd(buf) {
  // find EOCD
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('no EOCD')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const count = buf.readUInt16LE(eocd + 10)
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const cmtLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lNameLen + lExtraLen
    const comp = buf.subarray(start, start + compSize)
    let data
    if (method === 0) data = comp
    else if (method === 8) data = inflateRawSync(comp, { maxOutputLength: uncompSize + 1024 })
    else data = Buffer.from(`unsupported ${method}`)
    if (/full\.md$/i.test(name)) return data.toString('utf8')
    p += 46 + nameLen + extraLen + cmtLen
  }
  throw new Error('no full.md in zip')
}

main().catch((e) => { console.error('SMOKE TEST FAILED:', e.message); process.exit(1) })
