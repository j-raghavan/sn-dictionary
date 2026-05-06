// Plain-text consumer of the shared HTML renderer base.
//
// Public API (unchanged since v1.0.6):
//   - htmlToPlainText(html) → string
//   - looksLikeHtml(html)   → boolean
//
// Rendering rules are documented on HtmlBaseRenderer; this file
// supplies the string-buffer sink and per-line whitespace
// normalisation. Style hooks (bold / italic / colour) are inherited
// no-ops — the plain-text path strips styling and only carries
// layout-level structure.

import {parseHtml, looksLikeHtml} from './htmlParser';
import {HtmlBaseRenderer} from './htmlRenderBase';

export {looksLikeHtml};

class PlainTextRenderer extends HtmlBaseRenderer {
  private out = '';

  protected emitText(text: string): void {
    this.out += text;
  }

  protected emitLayout(text: string): void {
    this.out += text;
  }

  protected trimTrailingInlineWhitespace(): void {
    // Walk back over space / tab / NBSP. Stops at any other char
    // (including \n, which signals a previous line — that case is
    // already handled by contentOnLine being false in handleDivOpen,
    // so we wouldn't reach here from line-start).
    let end = this.out.length;
    while (
      end > 0 &&
      (this.out[end - 1] === ' ' ||
        this.out[end - 1] === '\t' ||
        this.out[end - 1] === ' ')
    ) {
      end--;
    }
    if (end < this.out.length) {
      this.out = this.out.slice(0, end);
    }
  }

  finalize(): string {
    // Per-line normalisation: preserve leading indent (so the
    // numbered-list nesting "  1. item" survives), collapse
    // INTERNAL whitespace runs to a single space, strip trailing
    // whitespace, and drop empty lines so paragraph / list-section
    // breaks don't render as visible blank rows.
    const lines = this.out
      .split('\n')
      .map((line) => {
        const match = line.match(/^([ \t]*)(.*)$/);
        if (!match) {
          return '';
        }
        const stripped = match[2].replace(/[ \t]+/g, ' ').trimEnd();
        return stripped === '' ? '' : match[1] + stripped;
      })
      .filter((line) => line !== '');
    return lines.join('\n');
  }
}

export const htmlToPlainText = (html: string): string => {
  // Fast path matches the v1.0.6 contract: pure plain text round-trips
  // through unchanged.
  if (!looksLikeHtml(html) && html.indexOf('&') < 0) {
    return html;
  }
  const renderer = new PlainTextRenderer();
  parseHtml(html, renderer);
  return renderer.finalize();
};
