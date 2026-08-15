// Tells TypeScript that Vite's `?raw` imports of .md files resolve to a string.
// Without this, TS would error on `import content from './foo.md?raw'`.
declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "*.txt?raw" {
  const content: string;
  export default content;
}

declare module "*.css";

// Global Window extensions for Electron IPC and E2E test helpers
interface Window {
  electron?: {
    ipcRenderer: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      on(channel: string, listener: (...args: unknown[]) => void): void;
      once(channel: string, listener: (...args: unknown[]) => void): void;
      send(channel: string, ...args: unknown[]): void;
      removeListener(
        channel: string,
        listener: (...args: unknown[]) => void,
      ): void;
    };
  };
  __DYAD_E2E__?: boolean;
  __DYAD_TERMINAL__?: boolean;
}
