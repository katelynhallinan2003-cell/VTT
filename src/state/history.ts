/** One undoable step. Both directions perform database writes. */
export interface Command {
  label: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** steps with the same key that happen close together (e.g. dragging a slider) collapse into one */
  key?: string;
  t?: number;
}

const MAX_STEPS = 100;
const COALESCE_MS = 1500;

/** Undo / redo for the things *you* did. It is local to this browser tab and cleared when the scene changes. */
export class History {
  private past: Command[] = [];
  private future: Command[] = [];
  private replaying = false;

  constructor(private onChange: () => void = () => {}) {}

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past.at(-1)?.label ?? null; }
  get redoLabel() { return this.future.at(-1)?.label ?? null; }

  push(cmd: Command) {
    if (this.replaying) return; // writes made by undo/redo themselves are not new steps
    const now = Date.now();
    const top = this.past.at(-1);
    if (cmd.key && top?.key === cmd.key && now - (top.t ?? 0) < COALESCE_MS) {
      top.redo = cmd.redo; // keep the original "undo" so one Ctrl+Z goes back to before the whole drag
      top.t = now;
    } else {
      this.past.push({ ...cmd, t: now });
      if (this.past.length > MAX_STEPS) this.past.shift();
    }
    this.future = [];
    this.onChange();
  }

  /** Returns the label of what was undone, or null when there was nothing to undo. Throws if a write was refused. */
  async undo(): Promise<string | null> {
    const cmd = this.past.pop();
    if (!cmd) return null;
    this.replaying = true;
    try { await cmd.undo(); this.future.push(cmd); }
    finally { this.replaying = false; this.onChange(); }
    return cmd.label;
  }

  async redo(): Promise<string | null> {
    const cmd = this.future.pop();
    if (!cmd) return null;
    this.replaying = true;
    try { await cmd.redo(); this.past.push(cmd); }
    finally { this.replaying = false; this.onChange(); }
    return cmd.label;
  }

  clear() {
    this.past = [];
    this.future = [];
    this.onChange();
  }
}
