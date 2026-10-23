/** The `undo` fixture: registers a step that puts the account back after the test. */
export type Undo = (step: () => Promise<unknown>) => void;

/**
 * The body of an `undo` fixture (tests/fixtures.ts, ui-tests/fixtures.ts): hands the
 * test a register function, then runs every registered step in reverse order, also
 * after a failure or a timeout. A step that throws fails the test; every failed step
 * is reported, since each names what was left on the account.
 */
export async function runUndo(use: (undo: Undo) => Promise<void>): Promise<void> {
  const steps: (() => Promise<unknown>)[] = [];
  await use((step) => {
    steps.push(step);
  });
  const errors: unknown[] = [];
  for (const step of steps.reverse()) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    const messages = errors.map((error) => (error instanceof Error ? error.message : String(error)));
    throw new Error(`${errors.length} undo steps failed:\n\n${messages.join('\n\n')}`);
  }
}
