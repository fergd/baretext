// Maps a cursor position from an old text to its counterpart in a new text
// that replaced it wholesale, via a common prefix/suffix diff -- used by
// setDoc() (api.js) to re-anchor the cursor after a full-buffer replace. See
// setDoc's own comment for why that's necessary.
export function mapPosAcrossReplace(oldText, newText, pos) {
  const maxCommon = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxCommon && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = maxCommon - prefix;
  while (suffix < maxSuffix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
  if (pos <= prefix) return pos;
  if (pos >= oldText.length - suffix) return newText.length - (oldText.length - pos);
  return prefix;
}
