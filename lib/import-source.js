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
    if (!isSupportedName(name) && !isSupportedName(url) && !isSupportedName(local) && !isSupportedTempUrl(url)) continue

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
  const kind = detectSourceKind(source)
  if (kind === 'har') return [ensureExtension(source, '.har')]
  if (kind === 'zip' || kind === 'rar') {
    const archive = ensureExtension(source, `.${kind}`)
    const outDir = path.join(workDir, `${Date.now()}-${path.basename(archive).replace(/[^a-zA-Z0-9_.-]/g, '_')}`)
    ensureDir(outDir)
    await extractArchive(archive, outDir)
    const harFiles = walk(outDir).filter(file => file.toLowerCase().endsWith('.har'))
    cleanupFiles.push(archive)
    return harFiles
  }
  return []
}

async function download (url, workDir, filename = '') {
  ensureDir(workDir)
  const downloadUrl = normalizeDownloadUrl(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  let target = ''

  try {
    const response = await fetch(downloadUrl, { signal: controller.signal })
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)

    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`download too large: ${contentLength} bytes`)
    }

    const safeName = sanitizeFileName(downloadFileName({ response, url: downloadUrl, filename }))
    target = uniqueTargetPath(workDir, safeName)
    await writeLimitedResponse(response, target, MAX_DOWNLOAD_BYTES)
    return target
  } catch (err) {
    if (target) removeFile(target)
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

function isSupportedTempUrl (value = '') {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'tmpfiles.org' ||
      host === 'temp.sh' ||
      host === 'file.io' ||
      host.endsWith('.file.io')
  } catch {
    return false
  }
}

function detectSourceKind (file) {
  const lower = file.toLowerCase()
  if (lower.endsWith('.har')) return 'har'
  if (lower.endsWith('.zip')) return 'zip'
  if (lower.endsWith('.rar')) return 'rar'

  const header = readHeader(file, 8)
  if (header[0] === 0x50 && header[1] === 0x4b) return 'zip'
  if (header.subarray(0, 4).toString('ascii') === 'Rar!') return 'rar'
  if (looksLikeHarJson(file)) return 'har'
  return ''
}

function looksLikeHarJson (file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(data?.log?.entries)
  } catch {
    return false
  }
}

function readHeader (file, bytes) {
  try {
    const fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(bytes)
    fs.readSync(fd, buffer, 0, bytes, 0)
    fs.closeSync(fd)
    return buffer
  } catch {
    return Buffer.alloc(0)
  }
}

function sanitizeFileName (name) {
  return path.basename(String(name)).replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function ensureExtension (file, extension) {
  if (file.toLowerCase().endsWith(extension)) return file
  const target = uniqueTargetPath(path.dirname(file), `${path.basename(file)}${extension}`)
  fs.renameSync(file, target)
  return target
}

function normalizeDownloadUrl (url) {
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase()
  if (host === 'tmpfiles.org' && !parsed.pathname.startsWith('/dl/') && !parsed.pathname.startsWith('/api/')) {
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length >= 2) {
      parsed.pathname = `/dl/${parts.join('/')}`
    }
  }
  return parsed.href
}

function downloadFileName ({ response, url, filename }) {
  return fileNameFromContentDisposition(response.headers.get('content-disposition')) ||
    filename ||
    path.basename(new URL(url).pathname) ||
    `download-${Date.now()}`
}

function fileNameFromContentDisposition (value = '') {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)
  if (encoded) return decodeURIComponent(encoded[1])

  const quoted = /filename="([^"]+)"/i.exec(value)
  if (quoted) return quoted[1]

  const plain = /filename=([^;]+)/i.exec(value)
  return plain?.[1]?.trim() || ''
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
