import fs from 'fs'

export function readHar (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function extractProfilesFromHar (har) {
  const entries = har?.log?.entries || []
  const profiles = {}
  const evidence = []

  for (const [index, entry] of entries.entries()) {
    const req = entry.request || {}
    const resText = entry.response?.content?.text || ''
    if (!req.url?.includes('/game_record/app/genshin/api/character/detail')) continue
    if (!isRetcodeOk(resText)) continue

    const body = parseJson(req.postData?.text)
    if (!body?.role_id) continue

    const headers = Object.fromEntries((req.headers || []).map(h => [String(h.name).toLowerCase(), h.value]))
    const profile = {
      device_id: headers['x-rpc-device_id'] || '',
      device_fp: headers['x-rpc-device_fp'] || '',
      device_name: headers['x-rpc-device_name'] || '',
      app_version: headers['x-rpc-app_version'] || '2.108.0',
      sys_version: headers['x-rpc-sys_version'] || '16',
      tool_verison: headers['x-rpc-tool_verison'] || 'v6.6.1-gr-cn',
      user_agent: headers['user-agent'] || ''
    }

    if (!profile.device_id || !profile.device_fp || !profile.user_agent) continue
    profiles[String(body.role_id)] = profile
    evidence.push({
      index,
      uid: String(body.role_id),
      endpoint: '/game_record/app/genshin/api/character/detail',
      hasDeviceId: Boolean(profile.device_id),
      hasDeviceFp: Boolean(profile.device_fp)
    })
  }

  return { profiles, evidence }
}

function isRetcodeOk (text) {
  const data = parseJson(text)
  return data?.retcode === 0
}

function parseJson (text = '') {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
