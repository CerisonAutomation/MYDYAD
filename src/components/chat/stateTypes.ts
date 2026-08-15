export type CustomTagState =
  | "pending"
  | "finished"
  | "warning"
  | "aborted"
  | "error";

/**
 * Common shape for Dyad custom tag nodes parsed from chat messages.
 * Components access `node.properties` to read tag-specific attributes.
 */
export interface DyadTagNode {
  properties: Record<string, string>;
  children?: unknown[];
}
