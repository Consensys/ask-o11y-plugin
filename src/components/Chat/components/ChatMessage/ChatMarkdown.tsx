import React from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

interface ChatMarkdownProps {
  content: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isExternalHref(href: string): boolean {
  // Only absolute http(s) and protocol-relative URLs can leave the tab.
  if (!/^(https?:)?\/\//i.test(href)) {
    return false;
  }
  if (typeof window === 'undefined') {
    return /^https?:\/\//i.test(href);
  }
  try {
    return new URL(href, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
}

// Raw HTML in model output can carry its own target; keep only _blank and
// force a safe rel on it. Registered only for the duration of one sanitize.
const forceSafeLinkTargets = (node: Element): void => {
  if (node.tagName !== 'A') {
    return;
  }
  const target = node.getAttribute('target');
  if (target && target !== '_blank') {
    node.removeAttribute('target');
    return;
  }
  if (target === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer');
  }
};

// The rendered HTML is built from LLM/agent output influenced by untrusted
// datasource data. These renderer overrides keep the code-block chrome and the
// external-link policy in one place; DOMPurify still sanitizes the result.
marked.use({
  renderer: {
    code({ text, lang }) {
      const rawLanguage = (lang ?? '').trim().split(/\s+/)[0] || '';
      const escapedLanguage = rawLanguage ? escapeHtml(rawLanguage) : '';
      const escapedCode = escapeHtml(text.replace(/\n$/, ''));
      const languageSpan = escapedLanguage
        ? `<span class="asko-code-lang">${escapedLanguage}</span>`
        : `<span class="asko-code-lang" aria-hidden="true"></span>`;
      const languageClass = escapedLanguage ? ` class="language-${escapedLanguage}"` : '';
      const ariaLabel = escapedLanguage ? `Copy ${escapedLanguage} code` : 'Copy code';
      return (
        `<div class="asko-code-block" data-asko-code-block="true">` +
        `<div class="asko-code-header">` +
        languageSpan +
        `<button type="button" class="asko-code-copy" data-asko-copy="true" aria-label="${ariaLabel}">Copy</button>` +
        `</div>` +
        `<pre><code${languageClass}>${escapedCode}</code></pre>` +
        `</div>`
      );
    },
    link({ href, title, tokens }) {
      const escapedHref = escapeHtml(href);
      const isExternal = isExternalHref(href);
      const targetAttrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapedHref}"${titleAttr}${targetAttrs}>${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

export function ChatMarkdown({ content }: ChatMarkdownProps): React.ReactElement | null {
  const styles = useStyles2(getStyles);

  const html = React.useMemo(() => {
    if (!content.trim()) {
      return '';
    }

    const rendered = marked.parse(content, {
      async: false,
      breaks: true,
      gfm: true,
    }) as string;

    // On top of DOMPurify's script/event filtering, explicitly forbid
    // embedded-content tags (the default profile would keep <iframe> etc.) to
    // block external-content phishing/UI-redress inside the chat panel.
    DOMPurify.addHook('afterSanitizeAttributes', forceSafeLinkTargets);
    try {
      return DOMPurify.sanitize(rendered, {
        FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'base', 'link', 'meta'],
        FORBID_ATTR: ['srcdoc', 'style'],
        ADD_ATTR: ['target'],
      });
    } finally {
      DOMPurify.removeHook('afterSanitizeAttributes', forceSafeLinkTargets);
    }
  }, [content]);

  const handleClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('[data-asko-copy]');
    if (!button) {
      return;
    }

    const previousTimer = button.dataset.askoTimer;
    if (previousTimer) {
      window.clearTimeout(Number(previousTimer));
      delete button.dataset.askoTimer;
    }

    const block = button.closest('[data-asko-code-block]');
    const text = block?.querySelector('code')?.textContent ?? '';
    navigator.clipboard?.writeText(text)?.then(
      () => {
        button.textContent = 'Copied';
        const timer = window.setTimeout(() => {
          button.textContent = 'Copy';
          delete button.dataset.askoTimer;
        }, 1500);
        button.dataset.askoTimer = String(timer);
      },
      () => undefined
    );
  }, []);

  if (!html) {
    return null;
  }

  return <div className={styles} onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

const getStyles = (theme: GrafanaTheme2) => css`
  font-size: 14px;
  line-height: 1.6;
  color: ${theme.colors.text.primary};
  overflow-wrap: break-word;

  && > :first-child {
    margin-top: 0;
  }

  && > :last-child {
    margin-bottom: 0;
  }

  && h1 {
    margin: 16px 0 8px;
    font-size: 18px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  && h2 {
    margin: 16px 0 8px;
    font-size: 16px;
    font-weight: 600;
    padding-bottom: 4px;
    border-bottom: 1px solid ${theme.colors.border.weak};
    overflow-wrap: anywhere;
  }

  && h3 {
    margin: 16px 0 8px;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  && h4 {
    margin: 16px 0 8px;
    font-size: 14px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  && h5 {
    margin: 16px 0 8px;
    font-size: 14px;
    font-weight: 600;
    color: ${theme.colors.text.secondary};
    overflow-wrap: anywhere;
  }

  && h6 {
    margin: 16px 0 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: ${theme.colors.text.secondary};
    overflow-wrap: anywhere;
  }

  && p {
    margin: 0 0 8px;
  }

  && ul,
  && ol {
    margin: 0 0 8px;
    padding-left: 20px;
  }

  && li {
    margin: 2px 0;
  }

  && li > ul,
  && li > ol {
    margin: 4px 0 0;
  }

  && blockquote {
    margin: 0 0 8px;
    padding-left: 12px;
    border-left: 3px solid ${theme.colors.border.medium};
    color: ${theme.colors.text.secondary};
  }

  && hr {
    margin: 16px 0;
    border: none;
    border-top: 1px solid ${theme.colors.border.weak};
  }

  && table {
    display: block;
    max-width: 100%;
    margin: 0 0 12px;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: 13px;
    line-height: 20px;
  }

  && th {
    padding: 6px 12px;
    border-bottom: 1px solid ${theme.colors.border.medium};
    color: ${theme.colors.text.secondary};
    font-weight: 500;
    text-align: left;
  }

  && td {
    padding: 6px 12px;
    border-bottom: 1px solid ${theme.colors.border.weak};
  }

  && a {
    color: ${theme.colors.text.link};
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  && a:hover {
    color: ${theme.colors.text.maxContrast};
  }

  && :not(pre) > code {
    padding: 1px 4px;
    border: 1px solid ${theme.colors.border.weak};
    border-radius: 2px;
    background-color: ${theme.colors.background.secondary};
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  && .asko-code-block {
    margin: 0 0 12px;
  }

  && .asko-code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 10px;
    border: 1px solid ${theme.colors.border.weak};
    border-bottom: none;
    border-radius: ${theme.shape.radius.default} ${theme.shape.radius.default} 0 0;
    background-color: ${theme.colors.background.primary};
  }

  && .asko-code-lang {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: ${theme.colors.text.secondary};
  }

  && .asko-code-copy {
    padding: 0;
    border: none;
    background: transparent;
    color: ${theme.colors.text.secondary};
    font-size: 11px;
    cursor: pointer;
  }

  && .asko-code-copy:hover {
    color: ${theme.colors.text.primary};
  }

  && .asko-code-block pre {
    margin: 0;
    padding: 12px;
    max-height: 400px;
    overflow: auto;
    border: 1px solid ${theme.colors.border.weak};
    border-radius: 0 0 ${theme.shape.radius.default} ${theme.shape.radius.default};
    background-color: ${theme.colors.background.secondary};
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: 12px;
    line-height: 18px;
    white-space: pre-wrap;
  }

  && .asko-code-block pre code {
    padding: 0;
    border: none;
    background: none;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  && img {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 2px;
  }

  && li:has(> input[type='checkbox']) {
    margin-left: -20px;
    list-style: none;
  }

  && input[type='checkbox'] {
    margin-right: 6px;
    accent-color: ${theme.colors.primary.main};
  }
`;
