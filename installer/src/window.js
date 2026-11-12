// The title of the window the person pasted the line into. Every instruction to come back to it
// names it this way, so it is set as the Installer starts and again each time a program run in
// the window returns (a program may retitle the window while it runs). The old title isn't put back.
export const windowTitle = 'Agent Jumpstart';

export function setWindowTitle() {
  process.title = windowTitle;
}
