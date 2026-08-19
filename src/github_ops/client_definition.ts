import type { RemoteClientDefinition } from "@/distributed_machines/remote_client";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import type { GithubOpsIgnoreReason } from "./state";
import { INITIAL_GITHUB_OPS_STATE } from "./state";
import {
  GITHUB_OPS_MACHINE_ID,
  type GithubOpsIntentEvent,
  GithubOpsIntentEventSchema,
  type GithubOpsKey,
  GithubOpsKeySchema,
  type GithubOpsRemoteSnapshot,
  GithubOpsRemoteSnapshotSchema,
  projectGithubOpsRemoteSnapshot,
} from "./transport";

export const githubOpsClientDefinition = {
  id: GITHUB_OPS_MACHINE_ID,
  host: "main",
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: GithubOpsKeySchema,
    encodeKey: (key) => key,
    eventCodec: GithubOpsIntentEventSchema,
    snapshotCodec: GithubOpsRemoteSnapshotSchema,
    keyToString: (key) => String(key.appId),
    unavailableSnapshot: (key) =>
      projectGithubOpsRemoteSnapshot(key.appId, 0, {
        state: INITIAL_GITHUB_OPS_STATE,
        activeInvocationRef: null,
        conflictResolutionClaimId: null,
      }),
  },
} satisfies RemoteClientDefinition<
  GithubOpsKey,
  GithubOpsRemoteSnapshot,
  GithubOpsIntentEvent,
  GithubOpsIgnoreReason | "stale-operation"
>;
