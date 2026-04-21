import Hyperbee from './index.js'
import Corestore from 'corestore'

const b = new Hyperbee(new Corestore('./sandbox/reduce'), {
  map(emit, key, value) {
    emit('count', 1)
  },
  reduce(emit, key, values, rereduce) {
    let total = 0
    for (const count of values) total += count
    emit('count', count)
  }
})

await b.ready()

const TOTAL = 100_000
const MAX_KEY = TOTAL - 1
const MAX_KEY_LEN = MAX_KEY.toString(16).length

// Make a string from an integer that will sort correctly
function makeKey(i) {
  return Buffer.from(i.toString(16).padStart(MAX_KEY_LEN, '0'))
}

if (b.core.length === 0) {
  const w = b.write()

  for (let i = 0; i < TOTAL; i++) {
    const k = makeKey(i)
    w.tryPut(k, k)
  }

  await w.flush()
}

// Calculate count without range
// console.log(await b.count())

let start = makeKey(123)
let end = makeKey(10000)

async function timeIt(f) {
  let t = performance.now()
  console.log(await b.countRange(start, end))
  console.log('Elapsed:', (performance.now() - t).toFixed(3), 'ms')
}

// Second calculation should be noticeably faster due to caching
await timeIt(async () => await b.countRange(start, end))
await timeIt(async () => await b.countRange(start, end))
