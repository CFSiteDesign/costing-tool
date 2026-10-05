/** Is the walkthrough on screen right now? A tiny module-level flag so things that sit above the tour in the tree
 *  (the Assistant's Cmd/Ctrl+K shortcut) can stay out of its way without a context. */
let active = false;

export const isTourActive = () => active;
export const setTourActive = (v: boolean) => { active = v; };
