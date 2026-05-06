// React Native renderer for HTML-formatted dictionary entries.
//
// Wraps a single root <Text> with one nested <Text> per non-empty
// styled span produced by htmlToSpans. Bold / italic / colour are
// applied per span; layout characters (newlines, indents, list
// markers, em-dashes) inherit only the popup's base style so they
// can never accidentally pick up an outer <i>POS</i> scope.
//
// Why a single root <Text> with nested children (and not a tree of
// <View><Text>...</Text></View> rows for lists): RN's <Text>
// composes inline styles cleanly when nested, and embedded \n
// produces the same visible layout an indented View tree would.
// Going wider would let us right-align numbers or hang-indent
// wrapped content, but at the cost of measurable component-tree
// size for entries with 50+ list items. The popup's body is also
// already inside a ScrollView; the tighter the tree, the smoother
// the e-ink scroll.

import React, {useMemo} from 'react';
import {Text, type StyleProp, type TextStyle} from 'react-native';
import {htmlToSpans, type SpanStyle} from './htmlToSpans';

type HtmlTextProps = {
  html: string;
  // Applied to the root <Text>. Children inherit font size, line
  // height, base colour, etc. via RN's Text-nesting rules. The body
  // style for definition text in this app is popupStyles.definition,
  // optionally scaled by the user's font-size selection.
  style?: StyleProp<TextStyle>;
};

const styleForSpan = (s: SpanStyle): TextStyle | undefined => {
  if (!s.bold && !s.italic && !s.color) {
    return undefined;
  }
  const out: TextStyle = {};
  if (s.bold) {
    out.fontWeight = '700';
  }
  if (s.italic) {
    out.fontStyle = 'italic';
  }
  if (s.color) {
    out.color = s.color;
  }
  return out;
};

export const HtmlText = ({html, style}: HtmlTextProps): React.JSX.Element => {
  // Memoise both the parse and the per-span style materialisation.
  // The popup re-renders on font-size changes (style prop changes),
  // but the underlying html string stays stable for a given lookup
  // — so the spans + their styleForSpan results don't churn.
  const children = useMemo(() => {
    const spans = htmlToSpans(html);
    return spans.map((span, i) => {
      const spanStyle = styleForSpan(span.style);
      // Don't wrap unstyled spans in their own <Text>; emit the raw
      // string. Trims tree depth for the common case (most layout
      // chunks + plain body text).
      if (!spanStyle) {
        return span.text;
      }
      return (
        <Text key={i} style={spanStyle}>
          {span.text}
        </Text>
      );
    });
  }, [html]);
  return <Text style={style}>{children}</Text>;
};
