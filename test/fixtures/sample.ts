import { serialize, type Manuscript, type Scene } from '../../packages/format/src/index.ts';

const P1 = "They spray the insecticides. Then pesticides. They don't need them. Aphids on the tomatoes? Plant basil. Or marigolds. The aphids stay away and it looks good, too. Same with carrots and onions. Onions keep the carrot flies off. Carrots keep the onion flies off. The people who lived here first knew this. They planted beans with maize and squash. The corn held the beans up. The beans fed the soil. The squash leaves shaded the weeds and kept the ground moist. You need that out here in the west.";
const P2 = 'The woman uneasily pivoted and waddled away, disappearing behind an end cap of plastic pots.';
const P3 = 'Zyanya resumed watering a row of penstemons. She waved the wand slowly, back and forth, in a silent rhythm, soaking through the flimsy plastic pots, water spattering on the floor. The diffused bright sunlight radiated through the clear, corrugated roof.';

const para = (text: string) => ({ type: 'paragraph' as const, content: [{ text }] });
let n = 0;
const scene = (name: string | null, ...paras: string[]): Scene => ({ id: `s${n++}`, name, link: null, blocks: paras.map(para) });

export function sampleManuscript(): Manuscript {
  const chapter = (i: number, title: string, scenes: Scene[]) => ({ id: `c${i}`, title, scenes });
  return {
    title: 'Testing the Spirits',
    chapters: [
      chapter(1, 'The Bag on the Table', [scene('Give Me the Bag', P1), scene(null, P2), scene('Fresh as This Snow', P3), scene(null, P2)]),
      chapter(2, 'Testing the Spirits', Array.from({ length: 8 }, (_, i) => scene(i % 2 ? null : `Scene ${i + 1}`, P2))),
      chapter(3, 'Cold Comforts', Array.from({ length: 7 }, (_, i) => scene(`Comfort ${i + 1}`, P3))),
      chapter(4, 'Maples in Suburbia', [scene('Early Frost', P2), scene('It Begins', P1, P2, P3), scene(null, P3), scene(null, P2)]),
      chapter(5, 'A Miracle in Mesa Springs', Array.from({ length: 3 }, (_, i) => scene(null, P1))),
    ],
    coldStorage: [scene('Cut scene', P2)],
  };
}

export const sampleFile = () => serialize(sampleManuscript());
