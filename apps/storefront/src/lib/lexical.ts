import type { LexicalNode, LexicalRoot } from './types'

/**
 * Minimal Lexical → HTML renderer.
 *
 * Payload's richText field stores a NODE TREE, not HTML and not Markdown:
 *
 *   { root: { children: [ { type: 'paragraph', children: [ { type: 'text', text: 'hi' } ] } ] } }
 *
 * That is a deliberate design choice — structured content can be rendered to
 * HTML, to React, to plain text, or to a native app's own components. The cost is
 * that a consumer has to walk the tree.
 *
 * This handles the node types this project produces plus the common ones a human
 * editor would add in the admin panel. Payload ships
 * `@payloadcms/richtext-lexical/react` for a full React renderer; this stays
 * dependency-free so the storefront needs no React island.
 *
 * Text formatting is a BITMASK on each text node, not nested tags.
 */

const FORMAT_BOLD = 1
const FORMAT_ITALIC = 1 << 1
const FORMAT_STRIKETHROUGH = 1 << 2
const FORMAT_UNDERLINE = 1 << 3
const FORMAT_CODE = 1 << 4

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderText(node: LexicalNode): string {
  let html = escapeHtml(node.text ?? '')
  const format = typeof node.format === 'number' ? node.format : 0

  // Order matters only for readability of the output, not correctness.
  if (format & FORMAT_CODE) html = `<code>${html}</code>`
  if (format & FORMAT_BOLD) html = `<strong>${html}</strong>`
  if (format & FORMAT_ITALIC) html = `<em>${html}</em>`
  if (format & FORMAT_UNDERLINE) html = `<u>${html}</u>`
  if (format & FORMAT_STRIKETHROUGH) html = `<s>${html}</s>`

  return html
}

function renderChildren(nodes: LexicalNode[] | undefined): string {
  return (nodes ?? []).map(renderNode).join('')
}

function renderNode(node: LexicalNode): string {
  switch (node.type) {
    case 'text':
      return renderText(node)

    case 'linebreak':
      return '<br />'

    case 'paragraph': {
      const inner = renderChildren(node.children)
      // Lexical emits an empty paragraph for a blank line; skip it rather than
      // rendering a <p> that only contributes vertical space.
      return inner.trim() ? `<p>${inner}</p>` : ''
    }

    case 'heading': {
      const tag = node.tag && /^h[1-6]$/.test(node.tag) ? node.tag : 'h2'
      return `<${tag}>${renderChildren(node.children)}</${tag}>`
    }

    case 'quote':
      return `<blockquote>${renderChildren(node.children)}</blockquote>`

    case 'list': {
      const tag = node.listType === 'number' ? 'ol' : 'ul'
      return `<${tag}>${renderChildren(node.children)}</${tag}>`
    }

    case 'listitem':
      return `<li>${renderChildren(node.children)}</li>`

    case 'link':
    case 'autolink': {
      const href = node.fields?.url ?? node.url ?? '#'
      const target = node.fields?.newTab ? ' target="_blank" rel="noopener noreferrer"' : ''
      return `<a href="${escapeHtml(href)}"${target}>${renderChildren(node.children)}</a>`
    }

    case 'horizontalrule':
      return '<hr />'

    case 'root':
      return renderChildren(node.children)

    default:
      // Unknown node types (uploads, blocks, relationships…) still contain text
      // worth showing, so recurse rather than dropping the subtree silently.
      return renderChildren(node.children)
  }
}

export function lexicalToHtml(content: LexicalRoot | null | undefined): string {
  if (!content?.root) {
    return ''
  }

  return renderNode(content.root)
}

/** Plain-text version, for meta descriptions and list previews. */
export function lexicalToText(content: LexicalRoot | null | undefined): string {
  if (!content?.root) {
    return ''
  }

  const collect = (node: LexicalNode): string =>
    node.type === 'text' ? (node.text ?? '') : (node.children ?? []).map(collect).join(' ')

  return collect(content.root).replace(/\s+/g, ' ').trim()
}

/**
 * The inverse: Lexical → plain text with blank lines between blocks, so an edit
 * form can round-trip content through a <textarea>.
 */
export function lexicalToPlainParagraphs(content: LexicalRoot | null | undefined): string {
  if (!content?.root?.children) {
    return ''
  }

  return content.root.children
    .map((block) => {
      const collect = (node: LexicalNode): string =>
        node.type === 'text' ? (node.text ?? '') : (node.children ?? []).map(collect).join('')

      return collect(block).trim()
    })
    .filter((text) => text.length > 0)
    .join('\n\n')
}
