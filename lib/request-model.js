import crypto from 'crypto'

const CN_SALT_4X = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs'

export function sortObject (obj = {}) {
  return Object.keys(obj).sort().reduce((ret, key) => {
    ret[key] = obj[key]
    return ret
  }, {})
}

export function queryString (obj = {}) {
  return new URLSearchParams(sortObject(obj)).toString()
}

export function createDs2 ({ body = null, query = null, salt = CN_SALT_4X } = {}) {
  const t = Math.floor(Date.now() / 1000)
  const r = Math.floor(Math.random() * 900000 + 100000)
  const b = body ? JSON.stringify(sortObject(body)) : ''
  const q = query ? queryString(query) : ''
  const c = crypto
    .createHash('md5')
    .update(`salt=${salt}&t=${t}&r=${r}&b=${b}&q=${q}`)
    .digest('hex')
  return `${t},${r},${c}`
}

export function pageForRequest ({ type = 'index', characterId = '' } = {}) {
  if (type === 'character-list') return 'v6.6.1-gr-cn_#/ys/role/all'
  if (type === 'character-detail') return `v6.6.1-gr-cn_#/ys/role/detail/${characterId}`
  return 'v6.6.1-gr-cn_#/ys'
}

export function createHeaders ({ profile, type = 'index', characterId = '', body = null, query = null, cookie = '' } = {}) {
  assertProfile(profile)
  return {
    'x-rpc-page': pageForRequest({ type, characterId }),
    'x-rpc-device_name': profile.device_name,
    'x-rpc-tool_verison': profile.tool_verison || 'v6.6.1-gr-cn',
    'x-rpc-device_id': profile.device_id,
    'x-rpc-app_version': profile.app_version || '2.108.0',
    'x-rpc-sys_version': profile.sys_version || '16',
    'x-rpc-device_fp': profile.device_fp,
    'x-rpc-client_type': '5',
    Accept: 'application/json, text/plain, */*',
    'User-Agent': profile.user_agent,
    DS: createDs2({ body, query }),
    Origin: 'https://webstatic.mihoyo.com',
    'X-Requested-With': 'com.mihoyo.hyperion',
    Referer: 'https://webstatic.mihoyo.com/',
    ...(body ? { 'Content-Type': 'application/json;charset=UTF-8' } : {}),
    ...(cookie ? { Cookie: cookie } : {})
  }
}

export function assertProfile (profile) {
  const required = ['device_id', 'device_fp', 'device_name', 'user_agent']
  const missing = required.filter(key => !profile?.[key])
  if (missing.length) {
    throw new Error(`device profile missing: ${missing.join(', ')}`)
  }
}
