#!/usr/bin/env node
import { readHar, extractProfilesFromHar } from '../lib/har-parser.js'
import { saveStore } from '../lib/device-store.js'

const [, , harFile, outFile = 'mys-device.local.json'] = process.argv

if (!harFile) {
  console.log('Usage: node scripts/extract-mys-device-from-har.mjs <Reqable.har> [mys-device.local.json]')
  process.exit(1)
}

const har = readHar(harFile)
const { profiles, evidence } = extractProfilesFromHar(har)

if (!Object.keys(profiles).length) {
  console.error('No successful character/detail device profile found in HAR.')
  process.exit(2)
}

saveStore(profiles, outFile)

console.log(`Wrote ${Object.keys(profiles).length} profile(s) to ${outFile}`)
for (const item of evidence) {
  console.log(`- uid=${item.uid} entry=${item.index} endpoint=${item.endpoint}`)
}
