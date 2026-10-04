import { describe, expect, it } from 'vitest'

import { lexicalToHtml, lexicalToPlainParagraphs, lexicalToText } from '../lexical'

/**
 * Tests for the Lexical renderer.
 *
 * This is the highest-stakes pure function in the storefront: its output goes
 * straight into `set:html`. If escaping regresses, CMS content becomes stored
 * XSS. That is the reason these tests exist — not coverage.
 */
const doc = (children: unknown[]) => ({ root: { type: 'root', children } }) as never

const text = (t: string, format = 0) => ({ type: 'text', text: t, format })

describe('lexicalToHtml', () => {
  it('renders paragraphs', () => {
    expect(lexicalToHtml(doc([{ type: 'paragraph', children: [text('Hello')] }]))).toBe(
      '<p>Hello</p>',
    )
  })

  it('ESCAPES html in text nodes', () => {
    const html = lexicalToHtml(
      doc([{ type: 'paragraph', children: [text('<script>alert(1)</script>')] }]),
    )

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes quotes and ampersands too', () => {
    const html = lexicalToHtml(
      doc([{ type: 'paragraph', children: [text(`a & b " c ' d`)] }]),
    )

    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
    expect(html).toContain('&#39;')
  })

  it('escapes a link href, so javascript: cannot be injected raw', () => {
    const html = lexicalToHtml(
      doc([
        {
          type: 'paragraph',
          children: [
            { type: 'link', fields: { url: '" onmouseover="alert(1)' }, children: [text('x')] },
          ],
        },
      ]),
    )

    expect(html).not.toContain('onmouseover="alert(1)"')
    expect(html).toContain('&quot;')
  })

  it('applies the format bitmask', () => {
    // 1 = bold, 2 = italic; 3 = both.
    expect(lexicalToHtml(doc([{ type: 'paragraph', children: [text('b', 1)] }]))).toContain('<strong>')
    expect(lexicalToHtml(doc([{ type: 'paragraph', children: [text('i', 2)] }]))).toContain('<em>')

    const both = lexicalToHtml(doc([{ type: 'paragraph', children: [text('x', 3)] }]))
    expect(both).toContain('<strong>')
    expect(both).toContain('<em>')
  })

  it('skips empty paragraphs rather than rendering hollow <p>', () => {
    expect(lexicalToHtml(doc([{ type: 'paragraph', children: [text('   ')] }]))).toBe('')
  })

  it('recurses into unknown node types instead of dropping content', () => {
    const html = lexicalToHtml(
      doc([{ type: 'someFutureBlock', children: [{ type: 'paragraph', children: [text('kept')] }] }]),
    )

    expect(html).toContain('kept')
  })

  it('handles null and empty input', () => {
    expect(lexicalToHtml(null)).toBe('')
    expect(lexicalToHtml(undefined)).toBe('')
  })

  it('renders headings, lists and quotes', () => {
    expect(lexicalToHtml(doc([{ type: 'heading', tag: 'h3', children: [text('H')] }]))).toBe('<h3>H</h3>')
    expect(lexicalToHtml(doc([{ type: 'quote', children: [text('Q')] }]))).toBe('<blockquote>Q</blockquote>')

    const list = lexicalToHtml(
      doc([{ type: 'list', listType: 'number', children: [{ type: 'listitem', children: [text('one')] }] }]),
    )
    expect(list).toBe('<ol><li>one</li></ol>')
  })

  it('rejects an invented heading tag rather than emitting it', () => {
    // A malicious or malformed `tag` must not become an arbitrary element.
    const html = lexicalToHtml(doc([{ type: 'heading', tag: 'script', children: [text('x')] }]))

    expect(html).not.toContain('<script')
    expect(html).toBe('<h2>x</h2>')
  })
})

describe('text extraction', () => {
  const sample = doc([
    { type: 'paragraph', children: [text('First para')] },
    { type: 'paragraph', children: [text('Second para')] },
  ])

  it('flattens to a single line', () => {
    expect(lexicalToText(sample)).toBe('First para Second para')
  })

  it('round-trips to blank-line-separated paragraphs for a textarea', () => {
    expect(lexicalToPlainParagraphs(sample)).toBe('First para\n\nSecond para')
  })
})
