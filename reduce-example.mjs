import Hyperbee from './index.js'
import Corestore from 'corestore'

const b = new Hyperbee(new Corestore('./sandbox/reduce'), {
    map(emit, key, value) {
        emit('count', 1);
    },
    reduce(emit, key, values, rereduce) {
        let total = 0;
        for (const count of values) total += count;
        emit('count', count);
    },
})

await b.ready()

const TOTAL = 100_000;
const MAX_KEY = TOTAL - 1;
const MAX_KEY_LEN = MAX_KEY.toString(16).length;

// Make a string from an integer that will sort correctly
function makeKey(i) {
    return Buffer.from(i.toString(16).padStart(MAX_KEY_LEN, '0'));
}

if (b.core.length === 0) {
  const w = b.write()

  for (let i = 0; i < TOTAL; i++) {
      const k = makeKey(i);
      w.tryPut(k, k);
  }

  await w.flush()
}

for await (const data of b.createReadStream()) {
  console.log(data.key, '-->', data.value)
}
