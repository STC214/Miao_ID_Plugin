import fs from 'fs'
import path from 'path'

const LOG_DIRS = [
  '/root/Yunzai/logs',
  '/root/Yunzai/log',
  '/app/Miao-Yunzai/logs',
  '/app/Miao-Yunzai/log'
]

const VERIFY_PATTERNS = [
  /遇到验证码/,
  /验证码失败/,
  /retcode["':\s]+1034/,
  /createVerification.*429/,
  /Too Many Requests/,
  /GTest\/register/,
  /GT-Manual/i
]

export function hasRecentVerificationLog ({ userId = '', since = Date.now() - 30000, now = Date.now() } = {}) {
  const files = findRecentLogFiles(now)
  const userText = String(userId || '')

  for (const file of files) {
    const text = tailFile(file, 96 * 1024)
    if (!text || !VERIFY_PATTERNS.some(pattern => pattern.test(text))) continue
    if (userText && !looksRelatedToUser(text, userText)) {
      const fileTime = fs.statSync(file).mtimeMs
      if (fileTime < since) continue
    }
    return true
  }

  return false
}

export function verificationHelpText () {
  return [
    '检测到米游社查询触发验证码。',
    '如果刚手动验证过仍失败，请导入一次你自己手机成功请求的 HAR：',
    '#米游社设备导入',
    '支持同消息/引用消息上传 har、zip、rar。导入后重启 trss-yunzai。'
  ].join('\n')
}

function findRecentLogFiles (now) {
  const files = []

  for (const dir of LOG_DIRS) {
    if (!fs.existsSync(dir)) continue
    collectFiles(dir, files, 2)
  }

  return files
    .filter(file => /\.(log|txt)$/i.test(file) || path.basename(file).includes('log'))
    .map(file => ({ file, stat: safeStat(file) }))
    .filter(item => item.stat && now - item.stat.mtimeMs < 5 * 60 * 1000)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, 16)
    .map(item => item.file)
}

function collectFiles (dir, files, depth) {
  if (depth < 0) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, files, depth - 1)
    if (entry.isFile()) files.push(full)
  }
}

function tailFile (file, maxBytes) {
  try {
    const stat = fs.statSync(file)
    const start = Math.max(0, stat.size - maxBytes)
    const fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buffer, 0, buffer.length, start)
    fs.closeSync(fd)
    return buffer.toString('utf8')
  } catch {
    return ''
  }
}

function looksRelatedToUser (text, userId) {
  return text.includes(`qq:${userId}`) ||
    text.includes(`(${userId})`) ||
    text.includes(`Private(${userId})`) ||
    text.includes(`Group(${userId})`)
}

function safeStat (file) {
  try {
    return fs.statSync(file)
  } catch {
    return null
  }
}
