import type { FieldHook } from 'payload'

/**
 * Turns "Hello, World! (Part 2)" into "hello-world-part-2".
 */
export const toSlug = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // drop punctuation
    .replace(/[\s_-]+/g, '-') // collapse whitespace/underscores into a single dash
    .replace(/^-+|-+$/g, '') // trim leading/trailing dashes

/**
 * A FIELD-level `beforeValidate` hook that derives a slug from a sibling field.
 *
 * Field hooks are the smallest unit of Payload's lifecycle. They receive the
 * value of *this* field plus `data` (the whole incoming document), so a field
 * can compute itself from its siblings without the collection knowing about it.
 *
 * Behaviour: only fills the slug when the editor left it blank. Never silently
 * rewrites a slug someone typed, because slugs are public URLs and changing one
 * breaks links.
 */
export const slugFrom =
  (sourceField: string): FieldHook =>
  ({ value, data, originalDoc }) => {
    if (typeof value === 'string' && value.length > 0) {
      return toSlug(value)
    }

    const source = (data?.[sourceField] ?? originalDoc?.[sourceField]) as string | undefined

    return source ? toSlug(source) : value
  }
