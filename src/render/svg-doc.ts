/**
 * The document the renderer draws into.
 *
 * `render/diagram.ts` builds one SVG tree and nothing else. In the browser that
 * tree has to be live elements — the app wires clicks to `data-node-id` and the
 * walkthrough measures with `getBBox`. On a server there is no `document` at
 * all, and what is wanted is markup.
 *
 * So the renderer talks to this narrow interface instead of to `document`, and
 * the two adapters below decide what comes out. Same drawing code, same
 * geometry, same colours; a picture built here and a picture built in the
 * studio cannot drift apart, which is the whole point.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** The slice of an element the renderer actually uses. */
export interface SvgNode {
  setAttribute(name: string, value: string): void;
  append(...children: (SvgNode | string)[]): void;
  /** Set to raw markup for the category glyphs, which arrive as path strings. */
  innerHTML: string;
}

/** A factory for elements in the SVG namespace. */
export interface SvgDoc {
  create(tag: string): SvgNode;
}

/**
 * Live DOM elements. The cast is the one place the two worlds meet: a real
 * `SVGElement` provides every method on `SvgNode`, but TypeScript will not take
 * a structural match across `append`, whose DOM signature wants `Node`.
 */
export const DOM_SVG_DOC: SvgDoc = {
  create: (tag) => document.createElementNS(SVG_NS, tag) as unknown as SvgNode,
};

/** `&`, `<` and `>` in text; also `"` inside an attribute, which is quoted. */
function escapeXml(value: string, attribute: boolean): string {
  let out = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (attribute) out = out.replace(/"/g, '&quot;');
  return out;
}

/**
 * Anything that is not a legal XML character. Log excerpts and command lines
 * come out of real captures and carry control bytes now and then; one of those
 * in an attribute makes the whole file unparseable, which is a poor trade for
 * a byte nobody can see.
 */
const ILLEGAL_XML = new RegExp(
  '[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]',
  'g',
);

function clean(value: string): string {
  return value.replace(ILLEGAL_XML, '');
}

class StringNode implements SvgNode {
  readonly tag: string;
  private readonly attrs: [string, string][] = [];
  private readonly children: (StringNode | string)[] = [];
  private raw = '';

  constructor(tag: string) {
    this.tag = tag;
  }

  get innerHTML(): string {
    return this.raw;
  }

  /**
   * Markup, passed through as written. The only caller is the icon set, which
   * is a fixed table of hand-written paths in the repository — not user data.
   */
  set innerHTML(markup: string) {
    this.raw = markup;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.push([name, value]);
  }

  append(...children: (SvgNode | string)[]): void {
    for (const child of children) this.children.push(child as StringNode | string);
  }

  serialise(): string {
    const attrs = this.attrs
      .map(([name, value]) => ` ${name}="${escapeXml(clean(value), true)}"`)
      .join('');

    const body =
      this.raw +
      this.children
        .map((child) => (typeof child === 'string' ? escapeXml(clean(child), false) : child.serialise()))
        .join('');

    if (!body) return `<${this.tag}${attrs}/>`;
    return `<${this.tag}${attrs}>${body}</${this.tag}>`;
  }
}

/** Builds a tree that serialises to markup, with no DOM anywhere. */
export class StringSvgDoc implements SvgDoc {
  create(tag: string): SvgNode {
    return new StringNode(tag);
  }
}

/** Serialise a tree built by `StringSvgDoc`. */
export function serialiseNode(node: SvgNode): string {
  if (!(node instanceof StringNode)) {
    throw new Error('serialiseNode expects a node built by StringSvgDoc');
  }
  return node.serialise();
}
