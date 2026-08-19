import type { RemoteClientDefinition } from "@/distributed_machines/remote_client";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { appRunRemoteIntentContract } from "./remote_intent_contract";
import type { AppRunIgnoreReason } from "./state";
import {
  type AppRunIntentEvent,
  AppRunIntentEventSchema,
  type AppRunKey,
  AppRunKeySchema,
  type AppRunRemoteSnapshot,
  AppRunRemoteSnapshotSchema,
  projectAppRunRemoteSnapshot,
} from "./transport";

export const appRunClientDefinition = {
  id: "app_run",
  host: "main",
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: AppRunKeySchema,
    encodeKey: (key) => key,
    eventCodec: AppRunIntentEventSchema,
    snapshotCodec: AppRunRemoteSnapshotSchema,
    keyToString: (key) => String(key.appId),
    unavailableSnapshot: (key) =>
      projectAppRunRemoteSnapshot(key.appId, 0, { type: "idle" }),
  },
  remoteIntent: {
    keyCodec: AppRunKeySchema,
    encodeKey: (key: AppRunKey) => key,
    keyToString: (key: AppRunKey) => String(key.appId),
    rendererIntentCodec: AppRunIntentEventSchema,
    snapshotCodec: AppRunRemoteSnapshotSchema,
    operationOutcome: appRunRemoteIntentContract.operationOutcome,
    intents: appRunRemoteIntentContract.intents,
  },
} satisfies RemoteClientDefinition<
  AppRunKey,
  AppRunRemoteSnapshot,
  AppRunIntentEvent,
  AppRunIgnoreReason
>;
