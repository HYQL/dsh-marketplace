/**
 * Mounts the prefix route in-process against a fake web server, in the order the
 * profile produced at boot: the plugin loads first, `ctx.webServer` appears
 * later. Proves that the bridge still mounts and that `entries` and `setEntries`
 * answer over it — with the tools registrar failing exactly as it does here.
 */
import { EventEmitter } from 'node:events'
import { Context } from '../node_modules/@deepseek-ai/cordis/lib/index.js'

const calls = []
const routes = []

/** A real emitter, so `req.on('data'|'end')` behaves like an HTTP request. */
function makeRequest(method, url, body) {
  const request = new EventEmitter()
  request.method = method
  request.url = url
  request.headers = {}
  setImmediate(() => {
    if (body !== undefined) request.emit('data', Buffer.from(body))
    request.emit('end')
  })
  return request
}

function makeResponse() {
  const response = {
    status: 0,
    body: '',
    payload: undefined,
    setHeader() {},
    writeHead(status) { response.status = status },
    end(body) {
      response.body = body ?? ''
      try { response.payload = JSON.parse(response.body) } catch { response.payload = undefined }
    },
  }
  return response
}

const ctx = new Context()
// The real registry: the job throws on the incompatible tool schema exactly as
// it does under the profile — the web-server bridge must survive it.
const { tools } = await import('@deepseek-ai/dsh-tools')
ctx.provide('tools', tools)
ctx.effect = (cb) => {
  let disposer
  try { disposer = cb() } catch { disposer = undefined }
  return () => { if (typeof disposer === 'function') disposer() }
}
ctx.on = () => () => {}

const { apply } = await import('../lib/host.js')
apply(ctx, { site: 'cn', apiKey: 'test-key', storeDir: 'C:/Users/Administrator/.dsh/agnes-media' })
console.log('after apply, routes:', routes.length, calls.join(' | '))

// The web server appears a moment later, mirroring a boot where web-runtime
// loads after the profile bundles.
ctx.provide('webServer', { register: (spec) => { calls.push(`register ${spec.path}`); routes.push(spec); return () => {} } })
await new Promise((resolve) => setTimeout(resolve, 900))

console.log('after webServer appears, routes:', routes.length)
for (const route of routes) console.log('  ', route.kind, route.path)

const prefix = routes.find((route) => route.path === '/agnes-media-studio/api')
if (prefix === undefined) {
  console.log('RESULT: bridge NOT mounted')
  process.exit(1)
}

// The registered handler starts the work and answers through `res` asynchronously
// (`void handleHttp(...)`), exactly like the web server's contract; wait a tick
// before reading the response.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

let failures = 0
const read = makeResponse()
try {
  await prefix.handler(makeRequest('GET', '/agnes-media-studio/api/entries'), read)
  await settle()
  console.log('GET  entries   ->', read.status, JSON.stringify(read.payload?.value ?? read.payload))
} catch (error) {
  console.log('GET  entries threw:', error && error.stack ? error.stack.slice(0, 500) : String(error))
  failures += 1
}
if (read.status !== 200 || read.payload?.ok !== true) failures += 1

const write = makeResponse()
await prefix.handler(makeRequest('POST', '/agnes-media-studio/api/setEntries', JSON.stringify({ drawerEnabled: true })), write)
await settle()
console.log('POST setEntries ->', write.status, JSON.stringify(write.payload?.value ?? write.payload))
if (write.status !== 200 || write.payload?.ok !== true) failures += 1

console.log(failures === 0
  ? 'RESULT: bridge mounted, entries answered'
  : `RESULT: bridge mounted, ${failures} request(s) failed`)
process.exit(failures === 0 ? 0 : 1)
