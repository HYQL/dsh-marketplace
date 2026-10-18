/**
 * Live end-to-end check of the built host half against the real Agnes gateway.
 *
 * Runs the shipped lib/host.js in this process with a stubbed Cordis context
 * (no DSH required), then exercises the real network: image, image-to-image,
 * video create + poll + download, model discovery, the job queue, and the
 * validation guards.
 *
 * Usage: node tools/live-check.mjs [--key sk-...] [--skip-video]
 */

import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const args = process.argv.slice(2)
const skipVideo = args.includes('--skip-video')
const keyArg = args.indexOf('--key')
const apiKey = keyArg >= 0 ? args[keyArg + 1] : process.env.AGNES_API_KEY

if (!apiKey) {
  console.error('no API key: pass --key sk-... or set AGNES_API_KEY')
  process.exit(2)
}

let pass = 0
let fail = 0
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log('  PASS  ' + n + (extra ? ` (${extra})` : '')) }
  else { fail++; console.log('  FAIL  ' + n + (extra ? ' :: ' + extra : '')) }
}

const work = mkdtempSync(join(tmpdir(), 'agnes-live-'))
const storeDir = join(work, 'store')
const downloadDir = join(work, 'media')

const provided = {}
const ctx = {
  tools: { register: () => () => {} },
  provide(name, value) { provided[name] = value; return () => {} },
  on() { return () => {} },
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
  get() { return undefined },
  webServer: { register: () => () => {} },
}

const mod = await import(pathToFileURL(join(root, 'lib', 'host.js')).href)
mod.apply(ctx, {
  site: 'cn',
  apiKey,
  downloadDir,
  storeDir,
  maxHistory: 10,
  pollIntervalMs: 4000,
  pollTimeoutMs: 420000,
})
const api = provided.agnesMedia
ok('host activated', api !== undefined)

// --- discovery --------------------------------------------------------------
try {
  const p = await api.probe()
  ok('probe: key configured', p.keyConfigured === true, p.keySource)
  ok('probe: image models discovered', p.imageModels.length > 0, p.imageModels.map((m) => m.id).join(','))
  ok('probe: video models discovered', p.videoModels.length > 0, p.videoModels.map((m) => m.id).join(','))
} catch (e) {
  ok('probe', false, e.message)
}

// --- image ------------------------------------------------------------------
let imageUrl = null
try {
  const t0 = Date.now()
  const r = await api.generateImage({ prompt: '一只在竹林中打滚的熊猫，写实摄影，柔光', size: '1K', ratio: '1:1' })
  imageUrl = r.images[0]?.url ?? null
  ok('image: url returned', typeof imageUrl === 'string' && imageUrl.startsWith('https://'), `${Math.round((Date.now() - t0) / 1000)}s`)
  ok('image: downloaded to disk', typeof r.downloads[0] === 'string' && r.downloads[0].length > 0)
} catch (e) {
  ok('image generation', false, e.message)
}

// --- image-to-image ---------------------------------------------------------
if (imageUrl !== null) {
  try {
    const r = await api.generateImage({ prompt: '把这只熊猫换成水彩画风格', image: [imageUrl], size: '1K' })
    ok('image-to-image: url returned', typeof r.images[0]?.url === 'string')
  } catch (e) {
    ok('image-to-image', false, e.message)
  }
}

// --- validation guards (no cost: rejected before a task exists) -------------
try {
  await api.generateVideo({ prompt: 'x', mode: 'text', first_frame: 'https://example.com/a.png' }, { wait: false })
  ok('text mode rejects media', false, 'no throw')
} catch (e) {
  ok('text mode rejects media', /text mode cannot carry/.test(e.message))
}
try {
  await api.generateVideo({ prompt: 'x', mode: 'keyframe' }, { wait: false })
  ok('keyframe mode requires a frame', /needs first_frame or last_frame/.test(e.message))
} catch (e) {
  ok('keyframe mode requires a frame', /needs first_frame or last_frame/.test(e.message))
}
try {
  await api.generateVideo({ prompt: 'x', mode: 'reference', images: ['a', 'b', 'c', 'd', 'e', 'f'] }, { wait: false })
  ok('reference mode caps images at 5', /must not exceed 5/.test(e.message))
} catch (e) {
  ok('reference mode caps images at 5', /must not exceed 5/.test(e.message))
}

// --- video: job queue, poll, download --------------------------------------
if (!skipVideo) {
  try {
    const job = await api.jobs.createVideo({
      prompt: '雨夜霓虹城市街道，镜头缓慢推进，电影感',
      seconds: '4',
      aspect_ratio: '16:9',
      mode: 'text',
    })
    ok('job: created', typeof job.id === 'string', job.id)
    const done = await api.jobs.wait(job.id)
    ok('job: settled', done !== undefined && done.status !== 'running', done?.status)
    ok('job: completed', done?.status === 'completed', done?.error ?? '')
    ok('job: remote url', typeof done?.urls?.[0] === 'string')
    ok('job: local download', typeof done?.downloads?.[0] === 'string')
    ok('job: progress reached 100', (done?.progress ?? 0) === 100, String(done?.progress))
    const listed = api.jobs.list()
    ok('job: listed from the store', listed.some((j) => j.id === job.id))
  } catch (e) {
    ok('video job', false, e.message)
  }

  // one-step image-to-video (keyframe generated first)
  try {
    const job = await api.jobs.createVideo({
      prompt: '熊猫在竹林里抬头看向镜头，轻微推镜',
      from_image_prompt: '可爱的熊猫坐在竹林里，写实摄影',
      seconds: '4',
      aspect_ratio: '16:9',
    })
    const done = await api.jobs.wait(job.id)
    ok('one-step image-to-video completes', done?.status === 'completed', done?.error ?? done?.status ?? '')
  } catch (e) {
    ok('one-step image-to-video', false, e.message)
  }
}

// --- persistence ------------------------------------------------------------
await api.jobs.wait(api.jobs.list()[0]?.id ?? '')
const files = readdirSync(storeDir)
ok('store file exists', files.includes('jobs.json'), files.join(','))
const media = readdirSync(downloadDir)
ok('media downloaded', media.length > 0, `${media.length} files`)

console.log(`\n${pass} passed, ${fail} failed`)
console.log(`work dir: ${work}`)
if (fail === 0) rmSync(work, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
