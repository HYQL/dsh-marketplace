/**
 * Unit checks for the browser-side upload pipeline.
 *
 * The interesting behaviour is not "does FileReader work" — it is the guard
 * rails: size rejection, the 5-image cap, downscale sizing, and format choice.
 * A minimal canvas/FileReader stand-in lets those run under Node.
 *
 * Usage: node tools/upload-check.mjs
 */

let pass = 0
let fail = 0
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log('  PASS  ' + n + (extra ? ` (${extra})` : '')) }
  else { fail++; console.log('  FAIL  ' + n + (extra ? ' :: ' + extra : '')) }
}

// --- browser stand-ins ------------------------------------------------------

class FakeFile {
  constructor(bytes, name, type) {
    this.size = bytes
    this.name = name
    this.type = type
  }
}

const draws = []
let lastCanvas = null
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected ' + tag)
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (img, x, y, w, h) => { draws.push({ w, h }) } }),
      toDataURL: (mime) => `data:${mime};base64,AAAA`,
    }
    lastCanvas = canvas
    return canvas
  },
}

globalThis.createImageBitmap = async () => ({ width: 4096, height: 3072, close() {} })

globalThis.FileReader = class {
  readAsDataURL(file) {
    // Small files pass through unchanged in the implementation under test.
    setTimeout(() => {
      this.result = `data:${file.type};base64,${'A'.repeat(8)}`
      this.onload()
    }, 0)
  }
}

globalThis.File = FakeFile

const { toReferenceImage, toReferenceImages, MAX_SOURCE_BYTES, MAX_REFERENCES, formatBytes, UploadError } =
  await import('../src/client/upload.ts')

// --- pass-through -----------------------------------------------------------
{
  const file = new FakeFile(1024, 'small.png', 'image/png')
  const ref = await toReferenceImage(file)
  ok('small image passes through untouched', ref.dataUri.startsWith('data:image/png;base64,'))
  ok('reference keeps its name', ref.name === 'small.png')
  ok('reference reports approximate bytes', ref.bytes > 0)
  ok('reference has a preview', ref.preview === ref.dataUri)
}

// --- downscale --------------------------------------------------------------
{
  draws.length = 0
  const big = new FakeFile(3 * 1024 * 1024, 'big.jpg', 'image/jpeg')
  const ref = await toReferenceImage(big)
  ok('large image is re-encoded', ref.dataUri.startsWith('data:image/jpeg;base64,'))
  ok('longest edge is capped at 2048', lastCanvas.width === 2048 && lastCanvas.height === 1536,
    `${lastCanvas.width}x${lastCanvas.height}`)
  ok('drawImage uses the scaled size', draws[0]?.w === 2048 && draws[0]?.h === 1536)
}

// --- transparency keeps PNG -------------------------------------------------
{
  const png = new FakeFile(2 * 1024 * 1024, 'alpha.png', 'image/png')
  const ref = await toReferenceImage(png)
  ok('transparent source stays PNG', ref.dataUri.startsWith('data:image/png;base64,'))
}

// --- rejections -------------------------------------------------------------
{
  let threw = null
  try { await toReferenceImage(new FakeFile(100, 'x.txt', 'text/plain')) } catch (e) { threw = e }
  ok('non-image rejected', threw instanceof UploadError, threw?.message)

  threw = null
  try { await toReferenceImage(new FakeFile(MAX_SOURCE_BYTES + 1, 'huge.png', 'image/png')) } catch (e) { threw = e }
  ok('oversized file rejected', threw instanceof UploadError && /too large/.test(threw.message), threw?.message)
}

// --- the 5-image cap --------------------------------------------------------
{
  const files = Array.from({ length: 8 }, (_, i) => new FakeFile(1024, `f${i}.png`, 'image/png'))
  const { added, errors } = await toReferenceImages(files, 0)
  ok('never adds more than 5', added.length === MAX_REFERENCES, String(added.length))
  ok('warns when files were dropped', errors.some((e) => /only 5/.test(e)), errors.join(';'))
}

{
  const files = Array.from({ length: 3 }, (_, i) => new FakeFile(1024, `g${i}.png`, 'image/png'))
  const { added } = await toReferenceImages(files, 4)
  ok('respects remaining capacity', added.length === 1, String(added.length))
}

{
  const { added, errors } = await toReferenceImages([], 2)
  ok('empty selection is a no-op', added.length === 0 && errors.length === 0)
}

// --- formatting -------------------------------------------------------------
ok('formats bytes', formatBytes(512) === '512 B')
ok('formats kilobytes', formatBytes(2048) === '2 KB')
ok('formats megabytes', formatBytes(3 * 1024 * 1024) === '3.0 MB')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
