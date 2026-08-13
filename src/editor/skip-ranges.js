import { syntaxTree } from '@codemirror/language';

// Ranges of the document that aren't prose — inline/fenced code and link
// URLs — where text-transform features (spellcheck flagging, em-dash
// autocorrect, ...) shouldn't touch what's literally there. Shared so every
// such feature treats "is this code" the same way.
export function collectSkipRanges(state) {
  const ranges = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'URL') {
        ranges.push({ from: node.from, to: node.to });
      }
    },
  });
  return ranges;
}

export function inSkipRange(ranges, pos) {
  return ranges.some((r) => pos >= r.from && pos < r.to);
}
