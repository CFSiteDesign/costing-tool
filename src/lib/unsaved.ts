/** Pages with an unsaved form hold a flag here (alongside their beforeunload guard), so in-app jumps such as
 *  replaying the walkthrough can ask before throwing someone's edits away. */
let holds = 0;

export function holdUnsaved(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
  };
}

export const hasUnsavedChanges = () => holds > 0;
