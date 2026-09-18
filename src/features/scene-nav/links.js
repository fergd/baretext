// A link belongs to the boundary after a scene. Keeping it in the Markdown
// makes links portable, undoable, and independent of titles or scene indices.
export const SCENE_LINK_MARKER = '<!-- SCENE LINK -->';
export const SCENE_GROUP_RE = /^<!-- SCENE GROUP: ([a-zA-Z0-9-]+) -->$/;
export const isLinkMetadata = text => text.trim() === SCENE_LINK_MARKER || SCENE_GROUP_RE.test(text.trim());
export function readSceneGroup(text) {
  return text.split('\n').map(line => line.trim().match(SCENE_GROUP_RE)).find(Boolean)?.[1] || null;
}
export function hasSceneLink(text) {
  return text.split('\n').some(line => line.trim() === SCENE_LINK_MARKER);
}
export function stripSceneLink(text) {
  return text.split('\n').filter(line => !isLinkMetadata(line)).join('\n');
}

// end is exclusive. Groups never cross chapter/Cold Storage boundaries.
export function sceneGroup(scenes, index) {
  let start = index, end = index + 1;
  const connected = (a, b) => a.linkedNext || (a.groupId && a.groupId === b.groupId);
  while (start > 0 && connected(scenes[start - 1], scenes[start])) start--;
  while (end < scenes.length && connected(scenes[end - 1], scenes[end])) end++;
  return { start, end };
}

export function linkedMembers(chapters, ci, si) {
  const scene = chapters[ci]?.scenes[si];
  if (!scene) return [];
  if (scene.groupId) return chapters.flatMap((c, chapterIndex) => c.scenes.flatMap((s, sceneIndex) => s.groupId === scene.groupId ? [{ chapterIndex, sceneIndex, scene: s }] : []));
  const { start, end } = sceneGroup(chapters[ci].scenes, si);
  return chapters[ci].scenes.slice(start, end).map((s, i) => ({ chapterIndex: ci, sceneIndex: start + i, scene: s }));
}
