import path from 'path'
import { extractProfilesFromHar, readHar } from '../lib/har-parser.js'
import { listProfiles, mergeProfiles, DEFAULT_STORE } from '../lib/device-store.js'
import { collectHarFiles } from '../lib/import-source.js'

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
        { reg: '^#?(米游社|mys)(设备|模型)(帮助)?$', fnc: 'help' },
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
      '',
      '说明：只导入你自己抓包得到的成功 character/detail 请求模型。zip/rar 内可以包含一个或多个 HAR。'
    ].join('\n'))
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
      const arg = String(e.msg || '').replace(/^#?(米游社|mys)(设备|模型)导入\s*/, '').trim()
      const files = await collectHarFiles({ event: e, arg })
      if (!files.length) {
        await e.reply([
          '没有找到可导入的 HAR。',
          '可用方式：',
          '1. #米游社设备导入 /root/Yunzai/temp/xxx.har',
          '2. #米游社设备导入 /root/Yunzai/temp/xxx.zip',
          '3. 发送 har/zip/rar 文件后，同消息或引用消息发送 #米游社设备导入'
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
