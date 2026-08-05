import { itemSlug } from '../../shared/utils/item-slug'

export function itemPath(item: string) {
  return `/items/${itemSlug(item)}`
}
