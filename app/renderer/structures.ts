// The story structures a book can be measured against (DECISIONS §26). The
// book keeps only the id; the arc's beats come with the story arc (§25).

export interface Structure {
  id: string;
  name: string;
}

export const STRUCTURES: readonly Structure[] = [
  { id: 'three-act', name: 'Three acts' },
  { id: 'heros-journey', name: 'The hero’s journey' },
  { id: 'save-the-cat', name: 'Save the Cat' },
  { id: 'seven-point', name: 'Seven-point' },
  { id: 'freytag', name: 'Freytag’s pyramid' },
  { id: 'kishotenketsu', name: 'Kishōtenketsu' },
];
