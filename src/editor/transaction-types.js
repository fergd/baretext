import { Annotation } from '@codemirror/state';
// Structural commands own the metadata in their result; typing filters must
// not reinterpret a move as the user splitting a scene.
export const structuralEdit = Annotation.define();
