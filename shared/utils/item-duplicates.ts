export type ItemNameSummary = {
  name: string
  uses: number
  lastUsed: string
}

export type ItemDuplicateGroup = {
  id: string
  variants: ItemNameSummary[]
  preferredTarget: string
  reasons: string[]
}

const reasonLabels = {
  formatting: 'Formatting differs',
  plural: 'Singular or plural wording',
  order: 'Same words in a different order',
  typo: 'Possible spelling variation'
} as const

type MatchReason = keyof typeof reasonLabels

type PreparedItem = {
  clean: string
  singular: string
  tokens: string[]
  sortedTokens: string
  numbers: string
}

function cleanName(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replaceAll(/[‘’ʼ]/g, "'")
    .replaceAll('&', ' and ')
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replaceAll(/\s+/g, ' ')
}

function singularToken(token: string) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && /(ches|shes|xes|zes|oes)$/.test(token)) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function singularName(value: string) {
  return value.split(' ').map(singularToken).join(' ')
}

function numericSignature(value: string) {
  return value.match(/\d+(?:[.,]\d+)?/g)?.join('|') ?? ''
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]!
}

function prepareItem(name: string): PreparedItem {
  const clean = cleanName(name)
  const singular = singularName(clean)
  const tokens = singular ? singular.split(' ') : []
  return {
    clean,
    singular,
    tokens,
    sortedTokens: [...tokens].sort().join(' '),
    numbers: numericSignature(clean)
  }
}

function addToIndex(index: Map<string, number[]>, key: string, itemIndex: number) {
  if (!key) return
  const matches = index.get(key) ?? []
  matches.push(itemIndex)
  index.set(key, matches)
}

function pairKey(left: number, right: number) {
  return left < right ? `${left}:${right}` : `${right}:${left}`
}

function compareTargets(left: ItemNameSummary, right: ItemNameSummary) {
  return right.uses - left.uses
    || right.lastUsed.localeCompare(left.lastUsed)
    || left.name.length - right.name.length
    || left.name.localeCompare(right.name)
}

export function findLikelyDuplicateItems(items: ItemNameSummary[]): ItemDuplicateGroup[] {
  const prepared = items.map(item => prepareItem(item.name))
  const parents = items.map((_, index) => index)
  const reasons = new Map<string, Set<MatchReason>>()
  const matchedPairs = new Set<string>()

  function root(index: number): number {
    if (parents[index] !== index) parents[index] = root(parents[index]!)
    return parents[index]!
  }

  function join(left: number, right: number, reason: MatchReason) {
    const leftRoot = root(left)
    const rightRoot = root(right)
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
    const key = pairKey(left, right)
    const pairReasons = reasons.get(key) ?? new Set<MatchReason>()
    pairReasons.add(reason)
    reasons.set(key, pairReasons)
    matchedPairs.add(key)
  }

  function joinIndexedMatches(index: Map<string, number[]>, reason: MatchReason) {
    for (const matches of index.values()) {
      for (let leftOffset = 0; leftOffset < matches.length; leftOffset += 1) {
        for (let rightOffset = leftOffset + 1; rightOffset < matches.length; rightOffset += 1) {
          const left = matches[leftOffset]!
          const right = matches[rightOffset]!
          if (!matchedPairs.has(pairKey(left, right))) join(left, right, reason)
        }
      }
    }
  }

  const formattingIndex = new Map<string, number[]>()
  const pluralIndex = new Map<string, number[]>()
  const wordOrderIndex = new Map<string, number[]>()
  const typoIndex = new Map<string, number[]>()

  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index]!
    addToIndex(formattingIndex, item.clean, index)
    addToIndex(pluralIndex, item.singular, index)
    addToIndex(wordOrderIndex, item.sortedTokens, index)
    for (let tokenIndex = 0; tokenIndex < item.tokens.length; tokenIndex += 1) {
      const context = item.tokens.map((token, position) => position === tokenIndex ? '*' : token).join('\u001f')
      addToIndex(typoIndex, `${item.numbers}\u001e${item.tokens.length}\u001e${tokenIndex}\u001e${context}`, index)
    }
  }

  joinIndexedMatches(formattingIndex, 'formatting')
  joinIndexedMatches(pluralIndex, 'plural')
  joinIndexedMatches(wordOrderIndex, 'order')

  for (const matches of typoIndex.values()) {
    for (let leftOffset = 0; leftOffset < matches.length; leftOffset += 1) {
      for (let rightOffset = leftOffset + 1; rightOffset < matches.length; rightOffset += 1) {
        const left = matches[leftOffset]!
        const right = matches[rightOffset]!
        if (matchedPairs.has(pairKey(left, right))) continue
        const leftTokens = prepared[left]!.tokens
        const rightTokens = prepared[right]!.tokens
        const changedIndex = leftTokens.findIndex((token, index) => token !== rightTokens[index])
        if (changedIndex < 0) continue
        const leftToken = leftTokens[changedIndex]!
        const rightToken = rightTokens[changedIndex]!
        if (Math.max(leftToken.length, rightToken.length) >= 5 && editDistance(leftToken, rightToken) === 1) {
          join(left, right, 'typo')
        }
      }
    }
  }

  const grouped = new Map<number, number[]>()
  for (let index = 0; index < items.length; index += 1) {
    const itemRoot = root(index)
    const group = grouped.get(itemRoot) ?? []
    group.push(index)
    grouped.set(itemRoot, group)
  }

  const orderedReasons = [...reasons.entries()].sort(([leftPair], [rightPair]) => {
    const [leftStart, leftEnd] = leftPair.split(':').map(Number)
    const [rightStart, rightEnd] = rightPair.split(':').map(Number)
    return leftStart! - rightStart! || leftEnd! - rightEnd!
  })

  return [...grouped.values()]
    .filter(indices => indices.length > 1)
    .map((indices) => {
      const variants = indices.map(index => items[index]!).sort(compareTargets)
      const groupReasons = new Set<MatchReason>()
      for (const [pair, pairReasons] of orderedReasons) {
        const [left, right] = pair.split(':').map(Number)
        if (indices.includes(left!) && indices.includes(right!)) {
          for (const reason of pairReasons) groupReasons.add(reason)
        }
      }
      return {
        id: indices.map(index => prepared[index]!.clean).sort().join('|'),
        variants,
        preferredTarget: variants[0]!.name,
        reasons: [...groupReasons].map(reason => reasonLabels[reason])
      }
    })
    .sort((left, right) => {
      const leftUses = left.variants.reduce((total, item) => total + item.uses, 0)
      const rightUses = right.variants.reduce((total, item) => total + item.uses, 0)
      return rightUses - leftUses || left.preferredTarget.localeCompare(right.preferredTarget)
    })
}
