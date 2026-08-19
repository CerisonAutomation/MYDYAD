import { createHash } from "node:crypto";
import { serializeImmutableChatTurnPayload } from "@/chat_stream/intent_payload";
import type { SerializableChatTurnIntent } from "@/chat_stream/transport";

export function computeChatTurnPayloadHash(
  intent: Omit<SerializableChatTurnIntent, "payloadHash">,
): string {
  return createHash("sha256")
    .update(serializeImmutableChatTurnPayload(intent))
    .digest("hex");
}
