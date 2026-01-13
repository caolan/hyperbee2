// Replace entry at existing index
const OP_SET = 0
// Insert new entry after given index
const OP_INSERT = 1
// Delete entry at index
const OP_DEL = 2
// Apply a sequence of operations
const OP_COHORT = 3

// Describes an operation to a CompressedArray
class DeltaOp {
  constructor(changed, type, index, pointer) {
    // Is this OP_SET, OP_INSERT, OP_DEL, or a OP_COHORT?
    this.type = type
    // Index in CompressedArray entries Array
    // (set to 0 and ignored if OP_COHORT)
    this.index = index
    // pointer:
    //   When type OP_SET: Pointer to set at index in entries
    //   When type OP_INSERT: Pointer to insert after index in entries
    //   When type OP_COHORT: Pointer to cohort's block in hypercore (not used by CompressedArray)
    //   When type OP_DEL: null
    this.pointer = pointer
    // Was this DeltaOp created after last WriteBatch flush?
    this.changed = changed
  }
}

// A sequence of OP_SET, OP_INSERT, OP_DEL operations.
// (A cohort cannot include other cohorts).
class DeltaCohort extends DeltaOp {
  constructor(changed, pointer, deltas) {
    super(changed, OP_COHORT, 0, pointer)
    this.deltas = deltas
  }
}

// An Array of pointers built by applying DeltaOps.
//
// Its purpose is to avoid having to flush all entries to the append-only
// log (Hypercore) on each write and instead to write a smaller DeltaOp
// where possible.
//
// To avoid the array of DeltaOps growing indefinitely, they are periodically
// squashed into a DeltaCohort when a configurable max is reached. Once
// there are max DeltaCohorts, the existing deltas array is dropped and
// replaced with a new DeltaCohort containing an OP_INSERT DeltaOp for each
// of the current entries in the CompressedArray.
class CompressedArray {
  constructor(delta) {
    // Pointers in the array.
    this.entries = []
    // Array of DeltaOps and DeltaCohorts required to build the entries
    // Array.
    this.delta = delta

    // Populate entries
    for (const d of delta) {
      if (d.type === OP_COHORT) {
        for (const dd of d.deltas) {
          apply(this.entries, dd.type, dd.index, dd.pointer)
        }
      } else {
        apply(this.entries, d.type, d.index, d.pointer)
      }
    }
  }

  get length() {
    return this.entries.length
  }

  touch(index) {
    const pointer = this.entries[index]
    if (pointer.changedBy === this) return
    this.set(index, pointer)
  }

  get(index) {
    return this.entries[index]
  }

  push(pointer) {
    this.insert(this.entries.length, pointer)
  }

  unshift(pointer) {
    this.insert(0, pointer)
  }

  pop() {
    if (this.entries.length === 0) return
    const head = this.entries[this.entries.length - 1]
    this.delete(this.entries.length - 1)
    return head
  }

  shift() {
    if (this.entries.length === 0) return
    const tail = this.entries[0]
    this.delete(0)
    return tail
  }

  _touch(pointer) {
    if (pointer) pointer.changedBy = this
  }

  insert(index, pointer) {
    if (!insert(this.entries, index, pointer)) return
    this._touch(pointer)
    this.delta.push(new DeltaOp(true, OP_INSERT, index, pointer))
  }

  delete(index) {
    if (!del(this.entries, index)) return
    this._touch(null)
    this.delta.push(new DeltaOp(true, OP_DEL, index, null))
  }

  set(index, pointer) {
    if (!set(this.entries, index, pointer)) return
    this._touch(pointer)
    this.delta.push(new DeltaOp(true, OP_SET, index, pointer))
  }

  flush(max, min) {
    // If there are more than 256 entries, CompressedArray overflows
    // and a flush will always return a new DeltaOp with an OP_INSERT
    // for each current entry. This should only happen in rebalances/splits.
    let overflow = false
    for (const d of this.delta) {
      if (d.index < 256) continue // has to be uint3, only happens in rebalances/splits
      overflow = true
      break
    }

    // If max deltas is not reached, return deltas unchanged.
    if (this.delta.length <= max && !overflow) return this.delta

    // Otherwise, take DeltaOps from end of deltas Array, leaving only DeltaCohorts.
    const direct = []
    while (this.delta.length && this.delta[this.delta.length - 1].type !== OP_COHORT) {
      direct.push(this.delta.pop())
    }
    direct.reverse()

    if (direct.length > min && direct.length < this.entries.length && !overflow) {
      // Squash DeltaOps into a new DeltaCohort and append it to deltas Array
      const co = new DeltaCohort(true, null, [])
      for (const d of direct) {
        co.deltas.push(d)
      }
      this.delta.push(co)
    } else {
      // Drop existing deltas and replace with a new DeltaCohort containing
      // an OP_INSERT DeltaOp for each of the current entries in the
      // CompressedArray.
      const co = new DeltaCohort(true, null, [])
      for (let i = 0; i < this.entries.length; i++) {
        const d = new DeltaOp(true, OP_INSERT, i, this.entries[i])
        co.deltas.push(d)
      }
      this.delta = [co]
    }

    return this.delta
  }
}

exports.CompressedArray = CompressedArray
exports.DeltaOp = DeltaOp
exports.DeltaCohort = DeltaCohort

exports.OP_SET = OP_SET
exports.OP_INSERT = OP_INSERT
exports.OP_DEL = OP_DEL
exports.OP_COHORT = OP_COHORT

function del(entries, index) {
  if (index >= entries.length) return false
  entries.splice(index, 1)
  return true
}

function insert(entries, index, pointer) {
  if (index >= entries.length + 1) return false
  entries.splice(index, 0, pointer)
  return true
}

function set(entries, index, pointer) {
  if (index >= entries.length) return false
  // if (entries[index] === pointer) return false
  entries[index] = pointer
  return true
}

// Apply a DeltaOp (but not DeltaCohort) to an entries Array.
function apply(entries, type, index, pointer) {
  if (type === OP_INSERT) {
    return insert(entries, index, pointer)
  }
  if (type === OP_DEL) {
    return del(entries, index)
  }
  if (type === OP_SET) {
    return set(entries, index, pointer)
  }
  return false
}
