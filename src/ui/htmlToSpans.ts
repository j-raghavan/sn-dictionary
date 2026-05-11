// Rich-rendering consumer of the shared HTML renderer base.
//
// Produces an array of `Span` objects — each span carries its text
// content plus the style (bold / italic / colour) that applies to
// it. The React Native popup composes these into nested <Text>
// elements (HtmlText.tsx), preserving the inline em-dash translation
// shape AND emboldening translations and italicising part-of-speech
// tags. Layout characters (newlines, indents, list markers, em-
// dashes) are emitted as unstyled spans so a surrounding <i>POS</i>
// scope can't accidentally italicise a list marker.
//
// The line-state, ol/ul nesting, and inline-vs-block <div> rules are
// shared with htmlToPlainText via HtmlBaseRenderer — this file is
// purely the span/style sink.

import {parseHtml, looksLikeHtml} from './htmlParser';
import {HtmlBaseRenderer, type StyleHint} from './htmlRenderBase';

export type SpanStyle = {
  bold?: boolean;
  italic?: boolean;
  // Empty string / undefined means "no colour hint". Truthy values
  // are the raw `color="..."` attribute from the dict HTML and may
  // contain anything (named colours, hex, malformed); the consumer
  // is responsible for resolving + sanitising them at render time.
  color?: string;
};

export type Span = {
  text: string;
  style: SpanStyle;
};

const EMPTY_STYLE: SpanStyle = Object.freeze({});

// Style hints stack into a single effective style. Bold / italic
// merge as logical OR (any active hint sets it). Colour stacks
// last-wins (the innermost `<font color>` overrides the outer one).
const mergeStyles = (stack: StyleHint[]): SpanStyle => {
  if (stack.length === 0) {
    return EMPTY_STYLE;
  }
  const merged: SpanStyle = {};
  for (const hint of stack) {
    if (hint.bold) {
      merged.bold = true;
    }
    if (hint.italic) {
      merged.italic = true;
    }
    if (hint.color !== undefined && hint.color !== '') {
      merged.color = hint.color;
    }
  }
  return merged;
};

const styleEquals = (a: SpanStyle, b: SpanStyle): boolean =>
  Boolean(a.bold) === Boolean(b.bold) &&
  Boolean(a.italic) === Boolean(b.italic) &&
  (a.color ?? '') === (b.color ?? '');

class SpanRenderer extends HtmlBaseRenderer {
  private spans: Span[] = [];
  private styleStack: StyleHint[] = [];
  private currentStyle: SpanStyle = EMPTY_STYLE;

  protected pushStyle(style: StyleHint): void {
    this.styleStack.push(style);
    this.currentStyle = mergeStyles(this.styleStack);
  }

  protected popStyle(): void {
    this.styleStack.pop();
    this.currentStyle = mergeStyles(this.styleStack);
  }

  protected emitText(text: string): void {
    this.appendSpan(text, this.currentStyle);
  }

  protected emitLayout(text: string): void {
    // Layout never carries surrounding bold / italic / colour. List
    // markers, em-dashes, and indents must render in the popup's
    // base style regardless of what scope they're inside.
    this.appendSpan(text, EMPTY_STYLE);
  }

  protected trimTrailingInlineWhitespace(): void {
    // Walk back through spans (last-emitted first), trimming
    // trailing space / tab / NBSP from each. Stops at the first
    // non-whitespace tail or once the stack empties. Coalescing
    // upstream means we usually only inspect the last span.
    while (this.spans.length > 0) {
      const tail = this.spans[this.spans.length - 1];
      let end = tail.text.length;
      while (
        end > 0 &&
        (tail.text[end - 1] === ' ' ||
          tail.text[end - 1] === '\t' ||
          tail.text[end - 1] === ' ')
      ) {
        end--;
      }
      if (end === tail.text.length) {
        return; // already non-whitespace at the tail
      }
      if (end === 0) {
        this.spans.pop(); // entirely whitespace — drop the span
        continue;
      }
      tail.text = tail.text.slice(0, end);
      return;
    }
  }

  finalize(): Span[] {
    return this.normalise(this.spans);
  }

  // -- internals --

  private appendSpan(text: string, style: SpanStyle): void {
    if (text.length === 0) {
      return;
    }
    // Coalesce same-style adjacent spans so downstream <Text> trees
    // stay shallow. This is purely a perf / cleanliness optimisation;
    // tests rely on coalesced output for stable assertions.
    const last = this.spans[this.spans.length - 1];
    if (last && styleEquals(last.style, style)) {
      last.text += text;
      return;
    }
    this.spans.push({text, style});
  }

  // Normalisation pass mirroring htmlToPlainText.finalize, applied
  // to the concatenated span text but rebuilt as spans so styling
  // is preserved. Per-line: preserve indent, collapse internal
  // whitespace runs, strip trailing whitespace, drop empty lines.
  private normalise(spans: Span[]): Span[] {
    if (spans.length === 0) {
      return spans;
    }
    // Step 1: walk the spans linearly and apply per-line shaping.
    // We track the position relative to the current line so we can
    // recognise the indent (leading spaces immediately following a
    // newline) and pass it through verbatim, while collapsing
    // mid-line whitespace runs. We also drop empty-line runs.
    type LineBuffer = {indent: string; chunks: Span[]; hasContent: boolean};
    const lines: LineBuffer[] = [{indent: '', chunks: [], hasContent: false}];
    let atLineStart = true;
    let lastWasSpace = false;

    const startNewLine = (): void => {
      lines.push({indent: '', chunks: [], hasContent: false});
      atLineStart = true;
      lastWasSpace = false;
    };

    const appendChunk = (text: string, style: SpanStyle): void => {
      if (text.length === 0) {
        return;
      }
      const line = lines[lines.length - 1];
      const prev = line.chunks[line.chunks.length - 1];
      if (prev && styleEquals(prev.style, style)) {
        prev.text += text;
      } else {
        line.chunks.push({text, style});
      }
      if (text.trim().length > 0) {
        line.hasContent = true;
      }
    };

    for (const span of spans) {
      let i = 0;
      while (i < span.text.length) {
        const ch = span.text[i];
        if (ch === '\n') {
          startNewLine();
          i++;
          continue;
        }
        if (atLineStart && (ch === ' ' || ch === '\t')) {
          // Capture the leading indent verbatim (single contiguous
          // run). The base class only emits indents in fixed-width
          // increments (4 spaces per nesting depth) via
          // emitListItemMarker, so the run length is bounded.
          const start = i;
          while (
            i < span.text.length &&
            (span.text[i] === ' ' || span.text[i] === '\t')
          ) {
            i++;
          }
          lines[lines.length - 1].indent += span.text.slice(start, i);
          continue;
        }
        // Past the indent: collapse runs of whitespace within the
        // line to a single space. lastWasSpace lets the collapse
        // span across span boundaries (`<i>foo </i> <i>bar</i>` is
        // two adjacent space-spans with different styles; only one
        // emits).
        if (ch === ' ' || ch === '\t') {
          if (!lastWasSpace) {
            appendChunk(' ', span.style);
            lastWasSpace = true;
          }
          atLineStart = false;
          i++;
          continue;
        }
        atLineStart = false;
        lastWasSpace = false;
        // Find the next whitespace / newline boundary; emit the
        // contiguous run as a single chunk in this span's style.
        const start = i;
        while (
          i < span.text.length &&
          span.text[i] !== '\n' &&
          span.text[i] !== ' ' &&
          span.text[i] !== '\t'
        ) {
          i++;
        }
        appendChunk(span.text.slice(start, i), span.style);
      }
    }

    // Step 2: drop empty lines, strip per-line trailing whitespace,
    // join with explicit \n layout spans.
    const result: Span[] = [];
    let appendNewline = false;
    for (const line of lines) {
      // Strip trailing whitespace within the line by walking back
      // through chunks until we find one with non-whitespace.
      while (line.chunks.length > 0) {
        const tail = line.chunks[line.chunks.length - 1];
        const trimmed = tail.text.replace(/[ \t]+$/, '');
        if (trimmed.length === 0) {
          line.chunks.pop();
          continue;
        }
        if (trimmed !== tail.text) {
          tail.text = trimmed;
        }
        break;
      }
      if (!line.hasContent) {
        continue;
      }
      if (appendNewline) {
        result.push({text: '\n', style: EMPTY_STYLE});
      }
      if (line.indent.length > 0) {
        result.push({text: line.indent, style: EMPTY_STYLE});
      }
      for (const chunk of line.chunks) {
        if (chunk.text.length === 0) {
          continue;
        }
        // Coalesce with the previous result span if styles match.
        const last = result[result.length - 1];
        if (last && styleEquals(last.style, chunk.style)) {
          last.text += chunk.text;
        } else {
          result.push(chunk);
        }
      }
      appendNewline = true;
    }
    return result;
  }
}

export const htmlToSpans = (html: string): Span[] => {
  if (html.length === 0) {
    return [];
  }
  // Fast path: pure plain text. One unstyled span. Avoids parser
  // overhead for the common WordNet-fallback case.
  if (!looksLikeHtml(html) && html.indexOf('&') < 0) {
    return [{text: html, style: EMPTY_STYLE}];
  }
  const renderer = new SpanRenderer();
  parseHtml(html, renderer);
  return renderer.finalize();
};
