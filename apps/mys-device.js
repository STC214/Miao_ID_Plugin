import path from 'path'
import { extractProfilesFromHar, readHar } from '../lib/har-parser.js'
import { listProfiles, mergeProfiles, DEFAULT_STORE } from '../lib/device-store.js'
import { collectHarFiles, removeFiles } from '../lib/import-source.js'
import { hasRecentVerificationLog, verificationHelpText } from '../lib/verification-watch.js'

const PluginBase = globalThis.plugin || class {
  constructor (options = {}) {
    Object.assign(this, options)
  }
}

export class MysDeviceApp extends PluginBase {
  constructor () {
    super({
      name: '米游社设备模型',
      dsc: '管理米游社 App H5 设备模型',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#?.*(米游社|mys).*(更新|刷新).*面板.*$', fnc: 'watchVerification' },
        { reg: '^#?(米游社|mys)(设备|模型)(帮助)?$', fnc: 'help' },
        { reg: '^#?(米游社|mys)(验证码|验证)帮助$', fnc: 'verificationHelp' },
        { reg: '^#?(米游社|mys)(设备|模型)列表$', fnc: 'list' },
        { reg: '^#?(米游社|mys)(设备|模型)检查$', fnc: 'list' },
        { reg: '^#?(米游社|mys)(设备|模型)导入(?:\\s+(.+))?$', fnc: 'importHar' }
      ]
    })
  }

  async help (e) {
    await e.reply([
      '米游社设备模型管理',
      '#米游社设备列表',
      '#米游社设备导入 /root/Yunzai/temp/xxx.har',
      '#米游社设备导入 /root/Yunzai/temp/xxx.zip',
      '#米游社设备导入 <同消息或引用消息中的 har/zip/rar 文件>',
      '#米游社验证帮助',
      '',
      '说明：只在私聊或临时对话窗口导入你自己抓包得到的成功 character/detail 请求模型。zip/rar 内可以包含一个或多个 HAR。'
    ].join('\n'))
  }

  async verificationHelp (e) {
    await e.reply(verificationHelpText())
  }

  async watchVerification (e) {
    const startedAt = Date.now()
    const userId = e.user_id || e.userId || e.sender?.user_id || ''
    const key = `${userId}:${Math.floor(startedAt / 120000)}`

    MysDeviceApp.recentWatchKeys ||= new Set()
    if (!MysDeviceApp.recentWatchKeys.has(key)) {
      MysDeviceApp.recentWatchKeys.add(key)
      setTimeout(async () => {
        try {
          if (hasRecentVerificationLog({ userId, since: startedAt })) {
            await e.reply(verificationHelpText())
          }
        } catch {
          // Do not disturb the original genshin or GT-Manual command flow.
        } finally {
          setTimeout(() => MysDeviceApp.recentWatchKeys.delete(key), 120000)
        }
      }, 8000)
    }

    return false
  }

  async list (e) {
    const profiles = listProfiles(DEFAULT_STORE)
    if (!profiles.length) {
      await e.reply('未找到本地设备模型：/root/Yunzai/config/config/mys-device.local.json')
      return
    }

    await e.reply(profiles.map(item => {
      return [
        `UID: ${item.uid}`,
        `device_id: ${item.hasDeviceId ? 'OK' : 'MISSING'}`,
        `device_fp: ${item.hasDeviceFp ? 'OK' : 'MISSING'}`,
        `app: ${item.appVersion || '-'}`,
        `sys: ${item.sysVersion || '-'}`
      ].join(' | ')
    }).join('\n'))
  }

  async importHar (e) {
    try {
      if (!isPrivateLikeEvent(e)) {
        await e.reply('为避免敏感信息泄露，仅限私聊或临时会话处理。')
        return
      }

      const arg = String(e.msg || '').replace(/^#?(米游社|mys)(设备|模型)导入\s*/, '').trim()
      const cleanupFiles = []
      const files = await collectHarFiles({ event: e, arg, cleanupFiles })
      if (!files.length) {
        await e.reply([
          '没有找到可导入的 HAR。',
          '可用方式：',
          '1. #米游社设备导入 /root/Yunzai/temp/xxx.har',
          '2. #米游社设备导入 /root/Yunzai/temp/xxx.zip',
          '3. 在私聊或临时对话窗口发送 har/zip/rar 文件后，同消息或引用消息发送 #米游社设备导入'
        ].join('\n'))
        return
      }

      const allProfiles = {}
      const allEvidence = []
      for (const file of files) {
        const har = readHar(file)
        const { profiles, evidence } = extractProfilesFromHar(har)
        Object.assign(allProfiles, profiles)
        allEvidence.push(...evidence.map(item => ({ ...item, file })))
      }

      if (!Object.keys(allProfiles).length) {
        await e.reply('HAR 中没有找到 retcode=0 的 character/detail 设备模型。')
        return
      }

      mergeProfiles(allProfiles, DEFAULT_STORE)
      removeFiles(cleanupFiles)
      await e.reply([
        `已导入 ${Object.keys(allProfiles).length} 个设备模型。`,
        ...allEvidence.map(item => `UID ${item.uid} <- ${path.basename(item.file)}#${item.index}`),
        '请重启 trss-yunzai 后生效。'
      ].join('\n'))
    } catch (err) {
      await e.reply(`导入失败：${err.message}`)
    }
  }
}

function isPrivateLikeEvent (e = {}) {
  const messageType = String(e.message_type || e.messageType || e.chat_type || e.chatType || '').toLowerCase()
  const detailType = String(e.detail_type || e.detailType || e.sub_type || e.subType || '').toLowerCase()

  if (messageType.includes('private') || messageType.includes('friend')) return true
  if (messageType.includes('temp') || detailType.includes('temp')) return true
  if (e.isPrivate || e.is_private || e.private) return true

  return false
}
