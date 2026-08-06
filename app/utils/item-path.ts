import { itemSlug } from '../../shared/utils/item-slug.ts'

export function itemPath(item: string) {
  return `/items/${itemSlug(item)}`
}
