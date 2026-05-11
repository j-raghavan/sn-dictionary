// Shared layout state machine for HTML→{plain text, RN spans}
// renderers. The parser (htmlParser.ts) emits the raw token stream;
// this base class encodes the structural rendering rules (numbered
// lists, indented bullets, inline em-dash translations, NBSP-aware
// line-state tracking) so both consumers stay in lockstep.
//
// Subclasses plug in two output sinks:
//   emitText(s)   — renders user-visible textual content, in whatever
//                   form the consumer wants (string append, span
//                   buffer, …). Called once per onText event.
//   emitLayout(s) — renders structural characters (newlines, indents,
//                   em-dash separators, list markers). Subclasses
//                   typically render these in the "default" style
//                   bucket so layout doesn't pick up bold / italic
//                   from a surrounding style scope.
//
// Style hooks (pushStyle / popStyle) default to no-ops so the
// plain-text renderer can ignore them. The span renderer overrides
// to maintain a style stack. The base class always pairs a push
// with a pop on every <div> open/close so style-stack subclasses
// stay balanced even when div-mode swaps from inline to block.
//
// List-marker scheme (per alioth9's request in issue #19): nested
// <ol> levels rotate through styles to make depth visually obvious
// rather than repeating "1. 2. 3." at every level. The classic
// outline cycle (decimal → lowercase alpha → lowercase roman →
// bullet for anything deeper) is what readers expect from English
// and French long-form documents and matches one of alioth9's
// listed options (`a. b. c.`). <ul> stays as bullets at every depth.

import {type HtmlVisitor, type TagInfo} from './htmlParser';

// 4-space indent per nesting level. alioth9 asked for "more than 2"
// in issue #19 and 4 is the de-facto standard for nested outlines
// in academic prose (and what OSS-Dict's reference rendering uses).
const INDENT_PER_DEPTH = '    ';

// Lowercase roman numeral table, descending so a single linear pass
// over the table emits the canonical compact form (4 → "iv", not
// "iiii"). The 1000-cap is generous; dictionary list depth-3 entries
// in practice cap out below 20.
const ROMAN_NUMERALS: ReadonlyArray<readonly [number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

// Counter is always ≥ 1 by the time we reach here (incremented in
// emitListItemMarker before lookup), so no n≤0 guard is needed.
const toRomanLower = (n: number): string => {
  let remaining = n;
  let out = '';
  for (const [val, sym] of ROMAN_NUMERALS) {
    while (remaining >= val) {
      out += sym;
      remaining -= val;
    }
  }
  return out;
};

// Spreadsheet-style alpha: 1→'a', 26→'z', 27→'aa', 28→'ab', …
// Wraps cleanly past 26 so a 30-item depth-2 list still renders
// (`aa. ab. ac. ad.`) instead of running off the end of the alphabet.
const toAlphaLower = (n: number): string => {
  let remaining = n;
  let out = '';
  while (remaining > 0) {
    remaining--;
    out = String.fromCharCode(97 + (remaining % 26)) + out;
    remaining = Math.floor(remaining / 26);
  }
  return out;
};

// Marker text (without trailing space) for an <ol>/<ul> item at the
// given 1-based depth. <ul> is always bulleted. <ol> rotates:
//   depth 1 → decimal      (1. 2. 3.)
//   depth 2 → lowercase α  (a. b. c.)
//   depth 3 → lowercase roman (i. ii. iii.)
//   depth ≥ 4 → bullet     (•) — pathological depths fall back to
//                                a marker the reader can't confuse
//                                with another numbered level.
const formatListMarker = (
  kind: 'ol' | 'ul',
  counter: number,
  depth: number,
): string => {
  if (kind === 'ul') {
    return '•';
  }
  if (depth <= 1) {
    return `${counter}.`;
  }
  if (depth === 2) {
    return `${toAlphaLower(counter)}.`;
  }
  if (depth === 3) {
    return `${toRomanLower(counter)}.`;
  }
  return '•';
};

export type ListFrame = {
  // Whether items are numbered (ol) or bulleted (ul). A stray <li>
  // without an enclosing list defaults to ul-style "•".
  kind: 'ol' | 'ul';
  // 1-based item counter, incremented on each <li> open.
  counter: number;
};

export type StyleHint = {
  bold?: boolean;
  italic?: boolean;
  // Colour hint from <font color="..."> attributes. Empty string =
  // no colour (kept distinct from `undefined` so a future renderer
  // could distinguish "tag had color attr but value was empty" from
  // "tag had no color attr").
  color?: string;
};

export abstract class HtmlBaseRenderer implements HtmlVisitor {
  protected listStack: ListFrame[] = [];

  // True once a non-whitespace, non-marker character has been emitted
  // on the current logical line. Drives the inline-vs-block <div>
  // decision: only "real" preceding content promotes a <div> to
  // inline em-dash. List markers don't qualify (`<li><div>x</div>`
  // still renders as "1. x", not "1.  — x").
  protected contentOnLine = false;

  // One slot per open <div>: true if it opened in inline-mode
  // (em-dash / comma join), false if block-mode (line-start).
  // Stack so nested inline divs (rare but valid) compose.
  protected inlineDivStack: boolean[] = [];

  // True immediately after an inline </div> closes, until the next
  // tag or non-whitespace text. Lets a peer <div> sibling open with
  // ", " (comma list) instead of repeating " — ".
  protected justClosedInlineDiv = false;

  onText(text: string): void {
    for (const ch of text) {
      if (ch === '\n') {
        this.contentOnLine = false;
        this.justClosedInlineDiv = false;
      } else if (ch !== ' ' && ch !== '\t' && ch !== ' ') {
        // U+00A0 NBSP counts as whitespace here so a Wikdict shape
        // with `&nbsp;<div>` doesn't escape the un-glue rule.
        this.contentOnLine = true;
        this.justClosedInlineDiv = false;
      }
    }
    this.emitText(text);
  }

  onTag(tag: TagInfo): void {
    const {name, isClose, attrs} = tag;
    switch (name) {
      case 'br':
        if (!isClose) {
          this.emitNewline();
        }
        return;
      case 'p':
        // Paragraph break: two newlines now; the per-line dedup in
        // most consumers collapses adjacent blank lines.
        if (!isClose) {
          this.emitNewline();
          this.emitNewline();
        }
        return;
      case 'ol':
      case 'ul':
        if (isClose) {
          this.listStack.pop();
        } else {
          this.listStack.push({kind: name, counter: 0});
        }
        this.justClosedInlineDiv = false;
        return;
      case 'li':
        if (!isClose) {
          this.emitListItemMarker();
        }
        return;
      case 'div':
        if (isClose) {
          this.handleDivClose();
        } else {
          this.handleDivOpen();
        }
        return;
      case 'b':
      case 'strong':
        if (isClose) {
          this.popStyle();
        } else {
          this.pushStyle({bold: true});
        }
        return;
      case 'i':
      case 'em':
        if (isClose) {
          this.popStyle();
        } else {
          this.pushStyle({italic: true});
        }
        return;
      case 'font':
        if (isClose) {
          this.popStyle();
        } else {
          this.pushStyle({color: attrs.color ?? ''});
        }
        return;
      default:
        // Inline / decorative tags we don't recognise (span, a, …)
        // drop — content keeps flowing through onText.
        return;
    }
  }

  // -- subclass hooks --

  // Renders a chunk of user-visible content. Receives raw text from
  // the parser, possibly containing whitespace runs and newlines —
  // subclasses post-process / segment as needed.
  protected abstract emitText(text: string): void;

  // Renders structural characters (newlines, indents, em-dashes,
  // list markers, comma joiners). Must NOT be styled with the
  // surrounding bold / italic / colour scope.
  protected abstract emitLayout(text: string): void;

  // Default no-op style hooks. The plain-text renderer ignores
  // styles entirely; the span renderer overrides both.
  protected pushStyle(_style: StyleHint): void {
    // intentional no-op
  }
  protected popStyle(): void {
    // intentional no-op
  }

  // Strip trailing inline-whitespace (space, tab, NBSP) from the
  // already-emitted output. Called immediately before an inline
  // separator (` — ` / `, `) is emitted so a trailing NBSP from
  // the body (e.g. Wikdict's `body&nbsp;<div>translation</div>`)
  // doesn't visually double up next to the separator. Default
  // no-op — subclasses override only if they keep mutable state.
  protected trimTrailingInlineWhitespace(): void {
    // intentional no-op
  }

  // -- shared layout helpers --

  protected emitNewline(): void {
    this.emitLayout('\n');
    this.contentOnLine = false;
    this.justClosedInlineDiv = false;
  }

  protected emitListItemMarker(): void {
    const top = this.listStack[this.listStack.length - 1];
    const depth = this.listStack.length;
    const indent = INDENT_PER_DEPTH.repeat(Math.max(0, depth - 1));
    if (top) {
      top.counter++;
      const marker = formatListMarker(top.kind, top.counter, depth);
      this.emitLayout(`\n${indent}${marker} `);
    } else {
      // <li> outside any list. Bullet at depth 0.
      this.emitLayout('\n• ');
    }
    this.contentOnLine = false;
    this.justClosedInlineDiv = false;
  }

  protected handleDivOpen(): void {
    if (this.contentOnLine) {
      this.trimTrailingInlineWhitespace();
      this.emitLayout(this.justClosedInlineDiv ? ', ' : ' — ');
      this.inlineDivStack.push(true);
      this.justClosedInlineDiv = false;
      // Inline-translation styling: bold makes the user-visible
      // distinction between the definition body and the
      // translation pop. Plain-text path no-ops this push.
      this.pushStyle({bold: true});
    } else {
      this.inlineDivStack.push(false);
      // Block-mode <div> inside an active list (i.e. a translation
      // sitting as the body of an <li>, like wikdict-de-fr's
      // `<li><div>chien</div></li>` shape) is bolded too — alioth9
      // flagged in issue #19 that single-line `<div>` translations
      // were bolded but the same word inside a multi-translation
      // <li><div>...</div> sibling list was not, and the
      // inconsistency hurt readability. Top-level wrapper <div>
      // (no enclosing list) keeps the empty style hint so it
      // doesn't visually pop above the body text.
      if (this.listStack.length > 0) {
        this.pushStyle({bold: true});
      } else {
        this.pushStyle({});
      }
    }
  }

  protected handleDivClose(): void {
    const wasInline = this.inlineDivStack.pop() ?? false;
    // Always pop — handleDivOpen always pushes (inline or empty).
    this.popStyle();
    if (wasInline) {
      this.justClosedInlineDiv = true;
    } else {
      this.emitNewline();
    }
  }
}
