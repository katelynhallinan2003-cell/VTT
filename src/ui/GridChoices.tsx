import type { GridOverlay } from '../core/gridOverlay';

const choices: [GridOverlay, string][] = [
  ['square', 'Squares'], ['pointy', 'Hex, rows'], ['flat', 'Hex, columns'], ['none', 'Gridless'],
];

export function GridChoices(props: { selected?: GridOverlay; onChoose: (choice: GridOverlay) => void }) {
  return <div class="seg grid-choices" role="group" aria-label="Grid type">
    {choices.map(([choice, label]) => <button key={choice} class={props.selected === choice ? 'on' : ''}
      aria-pressed={props.selected === undefined ? undefined : props.selected === choice}
      onClick={() => props.onChoose(choice)}>{label}</button>)}
  </div>;
}
