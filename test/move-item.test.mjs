import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { moveItem } from '../app/utils/move-item.ts'

describe('moveItem', () => {
  test('moves the first item to the last place without mutating the input', () => {
    const input = ['a', 'b', 'c']
    assert.deepEqual(moveItem(input, 0, 2), ['b', 'c', 'a'])
    assert.deepEqual(input, ['a', 'b', 'c'])
  })

  test('moves the last item to the first place and neighbours by one', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
    assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 2), ['a', 'c', 'b'])
  })

  test('returns an unchanged copy for the same index', () => {
    const input = ['a', 'b']
    const result = moveItem(input, 1, 1)
    assert.deepEqual(result, input)
    assert.notEqual(result, input)
  })

  test('returns an unchanged copy for out-of-range or non-integer indexes', () => {
    for (const [from, to] of [[-1, 0], [0, -1], [3, 0], [0, 3], [0.5, 1], [0, Number.NaN]]) {
      assert.deepEqual(moveItem(['a', 'b', 'c'], from, to), ['a', 'b', 'c'])
    }
    assert.deepEqual(moveItem([], 0, 0), [])
  })
})
