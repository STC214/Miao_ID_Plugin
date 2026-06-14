import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import AdmZip from 'adm-zip'
import { createExtractorFromData } from 'node-unrar-js'

const WORK_DIR = '/root/Yunzai/temp/mys-device-import'
const DOWNLOAD_TIMEOUT_MS = 30000
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024

export async function collectHarFiles ({ event, arg = '', workDir = WORK_DIR, cleanupFiles = [] } = {}) {
  const sources = await collectSources({ event, arg, workDir })
  const harFiles = []

  for (const source of sources) {
    const files = await expandSource(source, workDir, cleanupFiles)
    harFiles.push(...files)
  }

  return unique(harFiles).filter(file => file.toLowerCase().endsWith('.har'))
}

export async function collectSources ({ event, arg = '', workDir = WORK_DIR } = {}) {
  ensureDir(workDir)
  const sources = []
  const trimmed = String(arg || '').trim()

  if (trimmed) {
    sources.push(await materializeSource(trimmed, workDir))
  }

  for (const item of findMessageFiles(event)) {
    sources.push(await materializeMessageFile(item, workDir))
  }

  return unique(sources.filter(Boolean))
}

export function findMessageFiles (event) {
  const candidates = []
  const messages = [
    ...(Array.isArray(event?.message) ? event.message : []),
    ...(Array.isArray(event?.source?.message) ? event.source.message : []),
    ...(Array.isArray(event?.reply?.message) ? event.reply.message : [])
  ]

  for (const msg of messages) {
    const data = msg?.data || msg || {}
    const type = msg?.type || data?.type || ''
    if (type && type !== 'file' && type !== 'document') continue

    const name = data.name || data.file_name || data.filename || data.file || data.path || ''
    const url = data.url || data.file_url || data.download_url || ''
    const local = data.path || data.file || data.local || data.local_path || ''
    if (!isSupportedName(name) && !isSupportedName(url) && !isSupportedName(local)) continue

    candidates.push({ name, url, local })
  }

  return candidates
}

async function materializeMessageFile (item, workDir) {
  if (item.local && fs.existsSync(item.local)) return item.local
  if (item.url) return await download(item.url, workDir, item.name || path.basename(new URL(item.url).pathname))
  return item.local || ''
}

async function materializeSource (source, workDir) {
  if (/^https?:\/\//i.test(source)) {
    return await download(source, workDir, path.basename(new URL(source).pathname))
  }
  return source
}

async function expandSource (source, workDir, cleanupFiles) {
  if (!source || !fs.existsSync(source)) return []
  const lower = source.toLowerCase()
  if (lower.endsWith('.har')) return [source]
  if (lower.endsWith('.zip') || lower.endsWith('.rar')) {
    const outDir = path.join(workDir, `${Date.now()}-${path.basename(source).replace(/[^a-zA-Z0-9_.-]/g, '_')}`)
    ensureDir(outDir)
    await extractArchive(source, outDir)
    const harFiles = walk(outDir).filter(file => file.toLowerCase().endsWith('.har'))
    cleanupFiles.push(source)
    return harFiles
  }
  return []
}

async function download (url, workDir, filename = '') {
  ensureDir(workDir)
  const safeName = sanitizeFileName(filename || path.basename(new URL(url).pathname) || `download-${Date.now()}`)
  const target = uniqueTargetPath(workDir, safeName)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)

    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`download too large: ${contentLength} bytes`)
    }

    await writeLimitedResponse(response, target, MAX_DOWNLOAD_BYTES)
    return target
  } catch (err) {
    removeFile(target)
    if (err?.name === 'AbortError') {
      throw new Error(`download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function extractArchive (archive, outDir) {
  const lower = archive.toLowerCase()
  const errors = []

  if (lower.endsWith('.zip')) {
    try {
      extractZip(archive, outDir)
      return
    } catch (err) {
      errors.push(`adm-zip: ${err.message}`)
    }
  }

  if (lower.endsWith('.rar')) {
    try {
      await extractRar(archive, outDir)
      return
    } catch (err) {
      errors.push(`node-unrar-js: ${err.message}`)
    }
  }

  for (const [cmd, args] of fallbackTools(archive, outDir)) {
    try {
      execFileSync(cmd, args, { stdio: 'ignore' })
      return
    } catch (err) {
      errors.push(cmd)
    }
  }

  throw new Error(`failed to extract ${path.basename(archive)}; tried ${errors.join(', ')}`)
}

function extractZip (archive, outDir) {
  const zip = new AdmZip(archive)
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const target = safeJoin(outDir, entry.entryName)
    ensureDir(path.dirname(target))
    fs.writeFileSync(target, entry.getData())
  }
}

async function extractRar (archive, outDir) {
  const data = Uint8Array.from(fs.readFileSync(archive)).buffer
  const extractor = await createExtractorFromData({ data })
  const extracted = extractor.extract()

  for (const file of extracted.files) {
    if (file.fileHeader.flags.directory || !file.extraction) continue
    const target = safeJoin(outDir, file.fileHeader.name)
    ensureDir(path.dirname(target))
    fs.writeFileSync(target, Buffer.from(file.extraction))
  }
}

function fallbackTools (archive, outDir) {
  return [
    ['unzip', ['-qq', archive, '-d', outDir]],
    ['7z', ['x', '-y', `-o${outDir}`, archive]],
    ['7za', ['x', '-y', `-o${outDir}`, archive]],
    ['bsdtar', ['-xf', archive, '-C', outDir]],
    ['unar', ['-quiet', '-o', outDir, archive]]
  ]
}

function safeJoin (root, entryName) {
  const target = path.resolve(root, String(entryName).replace(/\\/g, '/'))
  const base = path.resolve(root)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`archive contains unsafe path: ${entryName}`)
  }
  return target
}

function walk (dir) {
  const ret = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) ret.push(...walk(full))
    if (entry.isFile()) ret.push(full)
  }
  return ret
}

function ensureDir (dir) {
  fs.mkdirSync(dir || os.tmpdir(), { recursive: true })
}

function isSupportedName (value = '') {
  return /\.(har|zip|rar)$/i.test(String(value))
}

function sanitizeFileName (name) {
  return path.basename(String(name)).replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function unique (items) {
  return [...new Set(items)]
}

export function removeFiles (files = []) {
  for (const file of unique(files)) {
    removeFile(file)
  }
}

async function writeLimitedResponse (response, target, maxBytes) {
  const reader = response.body?.getReader()
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error(`download too large: ${buffer.length} bytes`)
    fs.writeFileSync(target, buffer)
    return
  }

  const stream = fs.createWriteStream(target, { flags: 'wx' })
  let received = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      received += value.byteLength
      if (received > maxBytes) {
        throw new Error(`download too large: ${received} bytes`)
      }

      await writeChunk(stream, Buffer.from(value))
    }
  } finally {
    await finishStream(stream)
  }
}

function writeChunk (stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.write(chunk, err => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function finishStream (stream) {
  return new Promise((resolve, reject) => {
    stream.end(err => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function uniqueTargetPath (dir, filename) {
  const parsed = path.parse(filename)
  let target = path.join(dir, filename)
  let index = 1

  while (fs.existsSync(target)) {
    target = path.join(dir, `${parsed.name}-${index}${parsed.ext}`)
    index += 1
  }

  return target
}

function removeFile (file) {
  try {
    fs.rmSync(file, { force: true })
  } catch {
    // Keep imports best-effort: extracted HAR files are already preserved.
  }
}
