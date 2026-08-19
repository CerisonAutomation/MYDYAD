import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { assertTrustedRenderer } from "../utils/renderer_security";

/**
 * IPC handler type. Args remain `any[]` because Electron's `ipcMain.handle`
 * delivers untyped serialized data at the boundary. Callers annotate their
 * own parameters for type safety; the `any[]` here reflects the inherent
 * untypedness of IPC transport, not a type-safety shortcut.
 *
 * Return type is `unknown` (not `any`) so callers must narrow before use.
 */
type IpcHandler = (
  event: IpcMainInvokeEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- IPC args are untyped at the serialization boundary
  ...args: any[]
) => Promise<unknown> | unknown;

type TrustFailureHandler = (
  error: unknown,
  event: IpcMainInvokeEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- IPC args are untyped at the serialization boundary
  ...args: any[]
) => Promise<unknown> | unknown;

type TrustedIpcHandlerOptions = {
  onTrustFailure?: TrustFailureHandler;
};

/**
 * Registers an invoke handler that can only be called by the trusted Dyad
 * renderer. This is the sole production entry point for `ipcMain.handle` so
 * new and legacy handlers cannot accidentally omit the renderer trust guard.
 *
 * `onTrustFailure` lets envelope-based handlers preserve their wire format.
 * Raw handlers should omit it so Electron rejects the invoke as before.
 */
export function registerTrustedIpcHandler(
  channel: string,
  handler: IpcHandler,
  options: TrustedIpcHandlerOptions = {},
): void {
  // Optional chaining: ipcMain is undefined in some unit-test environments.
  ipcMain?.handle(channel, async (event, ...args) => {
    try {
      assertTrustedRenderer(event);
    } catch (error) {
      if (options.onTrustFailure) {
        return options.onTrustFailure(error, event, ...args);
      }
      throw error;
    }
    return handler(event, ...args);
  });
}
