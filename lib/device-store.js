import fs from 'fs'
import path from 'path'

export const DEFAULT_STORE = '/root/Yunzai/config/config/mys-device.local.json'

export function loadStore (file = DEFAULT_STORE) {
  if (!fs.existsSync(file)) return {}
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function saveStore (data, file = DEFAULT_STORE) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  try {
    fs.chmodSync(file, 0o600)
  } catch {}
}

export function mergeProfiles (incoming, file = DEFAULT_STORE) {
  const current = loadStore(file)
  const merged = { ...current, ...incoming }
  saveStore(merged, file)
  return merged
}

export function listProfiles (file = DEFAULT_STORE) {
  const data = loadStore(file)
  return Object.entries(data).map(([uid, profile]) => ({
    uid,
    hasDeviceId: Boolean(profile.device_id),
    hasDeviceFp: Boolean(profile.device_fp),
    appVersion: profile.app_version || '',
    sysVersion: profile.sys_version || ''
  }))
}
