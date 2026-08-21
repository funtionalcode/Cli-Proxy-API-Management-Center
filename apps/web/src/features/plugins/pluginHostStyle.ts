type PluginHostTheme = 'light' | 'dark';

interface PluginHostStyleOptions {
  theme: PluginHostTheme;
}

export interface PluginHostStyleBridge {
  refresh: (options?: Partial<PluginHostStyleOptions>) => boolean;
  disconnect: () => void;
}

const PLUGIN_HOST_STYLE_ID = 'cpamp-plugin-host-style';
const PLUGIN_HOST_ATTR = 'data-cpamp-plugin-host';
const PLUGIN_HOST_SCOPE = `:where(html[${PLUGIN_HOST_ATTR}='true'])`;
const CUSTOM_PROPERTY_NAME_RE = /^--[a-zA-Z0-9_-]+$/;

const HOST_STYLE_FALLBACKS: Record<string, string> = {
  '--app-bg': '#eff2f7',
  '--app-surface': '#ffffff',
  '--app-surface-muted': '#f6faff',
  '--app-border': 'rgba(15, 23, 42, 0.08)',
  '--app-text-primary': '#2c3e50',
  '--app-text-regular': '#5f6c7b',
  '--app-text-muted': '#8b95a6',
  '--app-radius-md': '12px',
  '--bg-primary': 'var(--app-surface)',
  '--bg-secondary': 'var(--app-bg)',
  '--bg-tertiary': 'var(--app-surface-muted)',
  '--text-primary': 'var(--app-text-primary)',
  '--text-secondary': 'var(--app-text-regular)',
  '--text-tertiary': 'var(--app-text-muted)',
  '--border-color': 'var(--app-border)',
  '--border-hover': 'rgba(64, 158, 255, 0.28)',
  '--primary-color': '#409eff',
  '--primary-hover': '#79bbff',
  '--primary-active': '#337ecc',
  '--primary-contrast': '#ffffff',
  '--focus-bg': 'color-mix(in srgb, var(--primary-color) 6%, var(--bg-primary))',
  '--focus-border': 'color-mix(in srgb, var(--primary-color) 28%, var(--border-color))',
  '--focus-inset': 'color-mix(in srgb, var(--primary-color) 22%, transparent)',
  '--danger-color': '#f56c6c',
  '--warning-color': '#e6a23c',
  '--success-color': '#67c23a',
};

const readFrameDocument = (iframe: HTMLIFrameElement): Document | null => {
  try {
    return iframe.contentDocument ?? iframe.contentWindow?.document ?? null;
  } catch {
    return null;
  }
};

const getOrCreateHead = (doc: Document): HTMLHeadElement | null => {
  if (doc.head) return doc.head;

  const root = doc.documentElement;
  if (!root) return null;

  const head = doc.createElement('head');
  root.insertBefore(head, root.firstChild);
  return head;
};

const collectHostVariables = () => {
  const vars = new Map<string, string>();

  Object.entries(HOST_STYLE_FALLBACKS).forEach(([name, value]) => {
    vars.set(name, value);
  });

  if (typeof window === 'undefined') return vars;

  const computed = window.getComputedStyle(document.documentElement);
  for (let index = 0; index < computed.length; index += 1) {
    const propertyName = computed.item(index);
    if (!CUSTOM_PROPERTY_NAME_RE.test(propertyName)) continue;

    const value = computed.getPropertyValue(propertyName).trim();
    if (value) {
      vars.set(propertyName, value);
    }
  }

  return vars;
};

const buildVariableBlock = () =>
  Array.from(collectHostVariables())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');

export const buildPluginHostStyle = (theme: PluginHostTheme) =>
  `
${PLUGIN_HOST_SCOPE} {
${buildVariableBlock()}
  --cpamp-plugin-font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color-scheme: ${theme === 'dark' ? 'dark' : 'light'};
  min-height: 100%;
  background: var(--bg-primary);
  color: var(--text-primary);
}

${PLUGIN_HOST_SCOPE} :where(body) {
  min-height: 100vh;
  margin: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--cpamp-plugin-font-family);
  font-size: 14px;
  line-height: 1.5;
  letter-spacing: 0;
}

${PLUGIN_HOST_SCOPE} *,
${PLUGIN_HOST_SCOPE} *::before,
${PLUGIN_HOST_SCOPE} *::after {
  box-sizing: border-box;
}

${PLUGIN_HOST_SCOPE} :where(body, button, input, select, textarea) {
  font-family: var(--cpamp-plugin-font-family);
}

${PLUGIN_HOST_SCOPE} :where(a) {
  color: var(--primary-color);
  text-decoration-color: color-mix(in srgb, var(--primary-color) 38%, transparent);
}

${PLUGIN_HOST_SCOPE} :where(a:hover) {
  color: var(--primary-active);
}

${PLUGIN_HOST_SCOPE} :where(h1, h2, h3, h4, h5, h6) {
  color: var(--text-primary);
  letter-spacing: 0;
}

${PLUGIN_HOST_SCOPE} :where(p, span, label, small, li, dt, dd) {
  color: inherit;
}

${PLUGIN_HOST_SCOPE} :where(hr) {
  border: 0;
  border-top: 1px solid var(--border-color);
}

${PLUGIN_HOST_SCOPE} :where(button, input, select, textarea) {
  color: var(--text-primary);
}

${PLUGIN_HOST_SCOPE} :where(
  input:not([type='checkbox']):not([type='radio']):not([type='range']),
  select,
  textarea
) {
  min-height: 34px;
  border: 1px solid var(--border-color);
  border-radius: var(--app-radius-sm, 8px);
  background: var(--app-input-bg, var(--bg-primary));
  color: var(--text-primary);
  outline: none;
  box-shadow: none;
}

${PLUGIN_HOST_SCOPE} :where(
  input:not([type='checkbox']):not([type='radio']):not([type='range']):focus,
  select:focus,
  textarea:focus
) {
  border-color: var(--primary-color);
  background: var(--app-input-bg-focus, var(--bg-primary));
  box-shadow: inset 0 0 0 1px var(--focus-inset);
}

${PLUGIN_HOST_SCOPE} :where(input, textarea)::placeholder {
  color: var(--text-tertiary);
}

${PLUGIN_HOST_SCOPE} :where(
  button,
  input[type='button'],
  input[type='reset'],
  input[type='submit'],
  [role='button']
) {
  min-height: 34px;
  border: 1px solid var(--border-color);
  border-radius: var(--app-radius-md, 12px);
  background: var(--app-surface-muted, var(--bg-tertiary));
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.2;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

${PLUGIN_HOST_SCOPE} :where(
  button:not(:disabled),
  input[type='button']:not(:disabled),
  input[type='reset']:not(:disabled),
  input[type='submit']:not(:disabled),
  [role='button']:not([aria-disabled='true'])
) {
  cursor: pointer;
}

${PLUGIN_HOST_SCOPE} :where(
  button:hover:not(:disabled),
  input[type='button']:hover:not(:disabled),
  input[type='reset']:hover:not(:disabled),
  [role='button']:hover:not([aria-disabled='true'])
) {
  border-color: var(--border-hover);
  background: var(--bg-hover, var(--app-surface-muted));
  color: var(--primary-color);
}

${PLUGIN_HOST_SCOPE} :where(
  button[type='submit'],
  input[type='submit'],
  .btn-primary,
  .button-primary,
  button.primary,
  input.primary,
  [role='button'].primary
) {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: var(--primary-contrast, #fff);
}

${PLUGIN_HOST_SCOPE} :where(
  button[type='submit']:hover:not(:disabled),
  input[type='submit']:hover:not(:disabled),
  .btn-primary:hover,
  .button-primary:hover,
  button.primary:hover:not(:disabled),
  input.primary:hover:not(:disabled),
  [role='button'].primary:hover:not([aria-disabled='true'])
) {
  border-color: var(--primary-hover);
  background: var(--primary-hover);
  color: var(--primary-contrast, #fff);
}

${PLUGIN_HOST_SCOPE} :where(button:disabled, input:disabled, select:disabled, textarea:disabled) {
  cursor: not-allowed;
  opacity: 0.62;
}

${PLUGIN_HOST_SCOPE} :where(table) {
  color: var(--text-primary);
  border-color: var(--border-color);
  border-collapse: collapse;
}

${PLUGIN_HOST_SCOPE} :where(thead, th) {
  background: color-mix(in srgb, var(--bg-tertiary) 72%, var(--bg-primary));
  color: var(--text-secondary);
}

${PLUGIN_HOST_SCOPE} :where(td, th) {
  border-color: var(--border-color);
}

${PLUGIN_HOST_SCOPE} :where(pre, code, kbd, samp) {
  border-color: var(--border-color);
  background: color-mix(in srgb, var(--bg-tertiary) 76%, var(--bg-primary));
  color: var(--text-primary);
}

${PLUGIN_HOST_SCOPE} :where(
  .card,
  .panel,
  .box,
  .tile,
  .widget,
  .surface,
  [class*='card'],
  [class*='panel']
) {
  border-color: var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
}

${PLUGIN_HOST_SCOPE} :where(:focus-visible) {
  outline: 2px solid var(--focus-border);
  outline-offset: 2px;
}

${PLUGIN_HOST_SCOPE}::selection,
${PLUGIN_HOST_SCOPE} ::selection {
  background: color-mix(in srgb, var(--primary-color) 24%, transparent);
  color: var(--text-primary);
}

${PLUGIN_HOST_SCOPE},
${PLUGIN_HOST_SCOPE} * {
  scrollbar-color: color-mix(in srgb, var(--primary-color) 32%, var(--border-color)) transparent;
}

${PLUGIN_HOST_SCOPE}::-webkit-scrollbar,
${PLUGIN_HOST_SCOPE} *::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

${PLUGIN_HOST_SCOPE}::-webkit-scrollbar-thumb,
${PLUGIN_HOST_SCOPE} *::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary-color) 32%, var(--border-color));
  background-clip: padding-box;
}

${PLUGIN_HOST_SCOPE}::-webkit-scrollbar-track,
${PLUGIN_HOST_SCOPE} *::-webkit-scrollbar-track {
  background: transparent;
}
`.trim();

const isPluginStylesheetElement = (element: Element) => {
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'style') return true;
  if (tagName !== 'link') return false;

  return (element.getAttribute('rel') ?? '')
    .split(/\s+/)
    .some((token) => token.toLowerCase() === 'stylesheet');
};

export const placePluginHostStyle = (head: HTMLHeadElement, style: HTMLStyleElement) => {
  const children = Array.from(head.children);
  const styleIndex = children.indexOf(style);
  const firstPluginStylesheetIndex = children.findIndex(
    (element) => element !== style && isPluginStylesheetElement(element)
  );

  if (
    firstPluginStylesheetIndex >= 0 &&
    (styleIndex < 0 || styleIndex > firstPluginStylesheetIndex)
  ) {
    head.insertBefore(style, children[firstPluginStylesheetIndex]);
    return;
  }

  if (styleIndex < 0) {
    head.appendChild(style);
  }
};

export const createPluginHostStyleBridge = (
  iframe: HTMLIFrameElement,
  options: PluginHostStyleOptions
): PluginHostStyleBridge | null => {
  let currentOptions = options;
  let observedDocument: Document | null = null;
  let observedHead: HTMLHeadElement | null = null;
  let observer: MutationObserver | null = null;
  let refreshTimer = 0;

  const clearRefreshTimer = () => {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
      refreshTimer = 0;
    }
  };

  const scheduleRefresh = () => {
    if (refreshTimer) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      ensureStyle();
    }, 0);
  };

  const observeDocument = (doc: Document, head: HTMLHeadElement) => {
    if (observedDocument === doc && observedHead === head) return;

    observer?.disconnect();
    observedDocument = doc;
    observedHead = head;

    if (typeof MutationObserver === 'undefined') {
      observer = null;
      return;
    }

    observer = new MutationObserver(scheduleRefresh);
    observer.observe(doc.documentElement, { childList: true });
    observer.observe(head, { childList: true });
  };

  const ensureStyle = (): boolean => {
    const doc = readFrameDocument(iframe);
    if (!doc?.documentElement) return false;

    const head = getOrCreateHead(doc);
    if (!head) return false;

    observeDocument(doc, head);

    doc.documentElement.setAttribute(PLUGIN_HOST_ATTR, 'true');
    doc.documentElement.setAttribute(
      'data-theme',
      currentOptions.theme === 'dark' ? 'dark' : 'white'
    );
    doc.documentElement.classList.add('cpamp-plugin-host');
    doc.documentElement.classList.toggle('theme-dark', currentOptions.theme === 'dark');
    doc.documentElement.classList.toggle('theme-light', currentOptions.theme !== 'dark');

    let style = doc.getElementById(PLUGIN_HOST_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement('style');
      style.id = PLUGIN_HOST_STYLE_ID;
    }
    style.setAttribute(PLUGIN_HOST_ATTR, 'true');

    const nextStyle = buildPluginHostStyle(currentOptions.theme);
    if (style.textContent !== nextStyle) {
      style.textContent = nextStyle;
    }

    placePluginHostStyle(head, style);

    return true;
  };

  if (!ensureStyle()) {
    return null;
  }

  return {
    refresh: (nextOptions) => {
      currentOptions = { ...currentOptions, ...nextOptions };
      return ensureStyle();
    },
    disconnect: () => {
      clearRefreshTimer();
      observer?.disconnect();
      observer = null;
      observedDocument = null;
      observedHead = null;
    },
  };
};
