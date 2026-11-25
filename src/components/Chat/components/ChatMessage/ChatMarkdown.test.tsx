/**
 * Unit tests for ChatMarkdown. These use the real `marked` and `DOMPurify`
 * so the renderer overrides and the sanitizer contract are both exercised.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { ChatMarkdown } from './ChatMarkdown';

jest.mock('@grafana/ui', () => ({
  useStyles2: () => '',
}));

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  } else {
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
});

function renderMarkdown(content: string) {
  return render(<ChatMarkdown content={content} />);
}

describe('ChatMarkdown', () => {
  it('renders nothing for empty content', () => {
    const { container } = renderMarkdown('   ');

    expect(container).toBeEmptyDOMElement();
  });

  it('renders markdown headings', () => {
    const { container } = renderMarkdown('## Heading');

    expect(container.querySelector('h2')).not.toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('Heading');
  });

  it('removes script tags from the rendered output', () => {
    const { container } = renderMarkdown('<script>alert(1)</script>');

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).not.toContain('alert(1)');
  });

  it('opens external links in a new tab with a safe rel', () => {
    const { container } = renderMarkdown('[x](https://example.com)');
    const link = container.querySelector('a');

    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });

  it('keeps internal links in the same tab', () => {
    const { container } = renderMarkdown('[y](/d/abc)');
    const link = container.querySelector('a');

    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/d/abc');
    expect(link?.hasAttribute('target')).toBe(false);
  });

  it('renders fenced code with language label and copy button', () => {
    const { container } = renderMarkdown('```json\n{"a":1}\n```');

    expect(container.querySelector('.asko-code-lang')?.textContent).toBe('json');
    expect(container.querySelector('[data-asko-copy]')).not.toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('{"a":1}');
  });

  it('omits the language label for a fence without a language', () => {
    const { container } = renderMarkdown('```\nplain\n```');

    expect(container.querySelector('.asko-code-header')).not.toBeNull();
    expect(container.querySelector('[data-asko-copy]')).not.toBeNull();
    expect(container.querySelector('.asko-code-lang')?.textContent).toBe('');
    expect(container.querySelector('pre code')?.hasAttribute('class')).toBe(false);
  });

  it('omits the language label for an indented code block', () => {
    const { container } = renderMarkdown('    indented line');

    expect(container.querySelector('.asko-code-header')).not.toBeNull();
    expect(container.querySelector('[data-asko-copy]')).not.toBeNull();
    expect(container.querySelector('.asko-code-lang')?.textContent).toBe('');
    expect(container.querySelector('pre code')?.hasAttribute('class')).toBe(false);
  });

  it('renders GFM tables', () => {
    const { container } = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('th')?.textContent).toBe('a');
  });

  it('drops a non-_blank target from raw HTML links', () => {
    const { container } = renderMarkdown('<a href="https://evil.example" target="_top">x</a>');

    expect(container.querySelector('a')?.hasAttribute('target')).toBe(false);
  });

  it('forces a safe rel on raw HTML links with target _blank', () => {
    const { container } = renderMarkdown('<a href="https://evil.example" target="_blank" rel="opener">x</a>');

    expect(container.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('removes inline style attributes', () => {
    const { container } = renderMarkdown('<span style="position:fixed;inset:0">x</span>');

    expect(container.querySelector('span')?.hasAttribute('style')).toBe(false);
  });

  it('copies code to the clipboard and shows Copied on success', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { container } = renderMarkdown('```json\n{"a":1}\n```');
    const button = container.querySelector<HTMLButtonElement>('[data-asko-copy]');
    expect(button).not.toBeNull();

    fireEvent.click(button!);

    expect(writeText).toHaveBeenCalledWith('{"a":1}');
    await waitFor(() => expect(button?.textContent).toBe('Copied'));
  });
});
