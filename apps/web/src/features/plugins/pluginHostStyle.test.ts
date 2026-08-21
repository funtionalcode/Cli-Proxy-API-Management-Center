import { describe, expect, it } from 'vitest';
import { buildPluginHostStyle, placePluginHostStyle } from './pluginHostStyle';

type FakeHead = {
  children: FakeElement[];
  mutations: number;
  insertBefore: (node: FakeElement, reference: FakeElement | null) => FakeElement;
  appendChild: (node: FakeElement) => FakeElement;
};

type FakeElement = {
  tagName: string;
  parentElement: FakeHead | null;
  attributes: Map<string, string>;
  getAttribute: (name: string) => string | null;
};

const createElement = (tagName: string, attributes: Record<string, string> = {}): FakeElement => {
  const element: FakeElement = {
    tagName: tagName.toUpperCase(),
    parentElement: null,
    attributes: new Map(Object.entries(attributes)),
    getAttribute: (name) => element.attributes.get(name) ?? null,
  };
  return element;
};

const createHead = (...initialChildren: FakeElement[]): FakeHead => {
  const head: FakeHead = {
    children: [],
    mutations: 0,
    insertBefore: (node, reference) => {
      head.mutations += 1;
      if (node.parentElement === head) {
        const currentIndex = head.children.indexOf(node);
        if (currentIndex >= 0) head.children.splice(currentIndex, 1);
      }
      node.parentElement = head;

      const referenceIndex = reference ? head.children.indexOf(reference) : -1;
      if (referenceIndex < 0) {
        head.children.push(node);
      } else {
        head.children.splice(referenceIndex, 0, node);
      }
      return node;
    },
    appendChild: (node) => {
      head.mutations += 1;
      if (node.parentElement === head) {
        const currentIndex = head.children.indexOf(node);
        if (currentIndex >= 0) head.children.splice(currentIndex, 1);
      }
      node.parentElement = head;
      head.children.push(node);
      return node;
    },
  };

  initialChildren.forEach((child) => head.appendChild(child));
  head.mutations = 0;
  return head;
};

const asHead = (head: FakeHead) => head as unknown as HTMLHeadElement;
const asStyle = (style: FakeElement) => style as unknown as HTMLStyleElement;

describe('plugin host style bridge', () => {
  it('generates scoped, overridable light and dark theme baselines', () => {
    const lightStyle = buildPluginHostStyle('light');
    const darkStyle = buildPluginHostStyle('dark');

    expect(lightStyle).not.toContain('!important');
    expect(lightStyle).toContain(":where(html[data-cpamp-plugin-host='true'])");
    expect(lightStyle).toContain(':where(p, span, label, small, li, dt, dd)');
    expect(lightStyle).toContain('color-scheme: light;');
    expect(darkStyle).toContain('color-scheme: dark;');
    expect(lightStyle).toContain('--app-bg: #eff2f7;');
  });

  it('places the host style before the first plugin stylesheet', () => {
    const metadata = createElement('meta');
    const pluginStyle = createElement('style');
    const hostStyle = createElement('style');
    const head = createHead(metadata, pluginStyle, hostStyle);

    placePluginHostStyle(asHead(head), asStyle(hostStyle));

    expect(head.children).toEqual([metadata, hostStyle, pluginStyle]);
  });

  it('recognizes stylesheet links and preserves an existing earlier position', () => {
    const metadata = createElement('meta');
    const hostStyle = createElement('style');
    const pluginLink = createElement('link', { rel: 'preload stylesheet' });
    const head = createHead(metadata, pluginLink, hostStyle);

    placePluginHostStyle(asHead(head), asStyle(hostStyle));
    expect(head.children).toEqual([metadata, hostStyle, pluginLink]);

    head.mutations = 0;
    placePluginHostStyle(asHead(head), asStyle(hostStyle));
    expect(head.mutations).toBe(0);
  });
});
