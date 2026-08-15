/** Minimal DOM helpers. Enough structure to keep the UI code declarative
 * without pulling in a framework the diagram code would never use. */

type Child = Node | string | null | undefined | false;

export interface ElAttrs {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  checked?: boolean;
  disabled?: boolean;
  rows?: number;
  min?: string;
  max?: string;
  step?: string;
  accept?: string;
  multiple?: boolean;
  href?: string;
  target?: string;
  rel?: string;
  data?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: any) => void>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs.class) node.className = attrs.class;
  if (attrs.text !== undefined) node.textContent = attrs.text;
  if (attrs.html !== undefined) node.innerHTML = attrs.html;
  if (attrs.title) node.title = attrs.title;

  const anyNode = node as any;
  if (attrs.type) anyNode.type = attrs.type;
  if (attrs.value !== undefined) anyNode.value = attrs.value;
  if (attrs.placeholder) anyNode.placeholder = attrs.placeholder;
  if (attrs.checked !== undefined) anyNode.checked = attrs.checked;
  if (attrs.disabled !== undefined) anyNode.disabled = attrs.disabled;
  if (attrs.rows !== undefined) anyNode.rows = attrs.rows;
  if (attrs.min !== undefined) anyNode.min = attrs.min;
  if (attrs.max !== undefined) anyNode.max = attrs.max;
  if (attrs.step !== undefined) anyNode.step = attrs.step;
  if (attrs.accept !== undefined) anyNode.accept = attrs.accept;
  if (attrs.multiple !== undefined) anyNode.multiple = attrs.multiple;
  if (attrs.href !== undefined) anyNode.href = attrs.href;
  if (attrs.target !== undefined) anyNode.target = attrs.target;
  if (attrs.rel !== undefined) anyNode.rel = attrs.rel;

  if (attrs.data) {
    for (const [k, v] of Object.entries(attrs.data)) node.dataset[k] = v;
  }
  if (attrs.attrs) {
    for (const [k, v] of Object.entries(attrs.attrs)) node.setAttribute(k, v);
  }
  if (attrs.on) {
    for (const [event, handler] of Object.entries(attrs.on)) {
      if (handler) node.addEventListener(event, handler as EventListener);
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** A labelled form control. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    control,
    hint ? h('span', { class: 'field-hint', text: hint }) : null,
  );
}

export function select(
  options: { value: string; label: string; group?: string }[],
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const node = h('select', { on: { change: (e) => onChange((e.target as HTMLSelectElement).value) } });
  let currentGroup: HTMLOptGroupElement | null = null;
  let currentGroupName = '';

  for (const option of options) {
    const optionEl = h('option', { value: option.value, text: option.label });
    if (option.value === value) optionEl.selected = true;

    if (option.group) {
      if (option.group !== currentGroupName) {
        currentGroup = document.createElement('optgroup');
        currentGroup.label = option.group;
        currentGroupName = option.group;
        node.append(currentGroup);
      }
      currentGroup?.append(optionEl);
    } else {
      currentGroup = null;
      currentGroupName = '';
      node.append(optionEl);
    }
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = path;
  return svg;
}
