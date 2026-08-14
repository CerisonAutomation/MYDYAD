/**
 * Vite plugin that replaces posthog-js and posthog-js/react with no-op modules.
 * This removes all PostHog tracking from the build.
 */
import type { Plugin } from "vite";

const NOOP_MODULE_ID = "\0no-posthog";
const NOOP_MODULE_CODE = `
// PostHog type for TypeScript compatibility
export const posthog = { 
  init: () => ({}), 
  identify: () => {}, 
  capture: () => {}, 
  captureException: () => {},
  opt_out_capturing: () => {}, 
  has_opted_out_capturing: () => true, 
  get_distinct_id: () => 'noop',
  resetGroups: () => {},
  people: { set: () => {} }
};
export default posthog;
`;

const NOOP_REACT_MODULE_CODE = `
export const PostHogProvider = ({ children }) => children;
export function usePostHog() { 
  return { 
    init: () => ({}), 
    identify: () => {}, 
    capture: () => {}, 
    captureException: () => {},
    opt_out_capturing: () => {}, 
    has_opted_out_capturing: () => true, 
    get_distinct_id: () => 'noop',
    resetGroups: () => {},
    people: { set: () => {} }
  }; 
}
`;

export function noPostHogPlugin(): Plugin {
  return {
    name: "no-posthog",
    enforce: "pre",
    resolveId(id) {
      if (id === "posthog-js") {
        return NOOP_MODULE_ID + ":js";
      }
      if (id === "posthog-js/react") {
        return NOOP_MODULE_ID + ":react";
      }
      return null;
    },
    load(id) {
      if (id === NOOP_MODULE_ID + ":js") {
        return NOOP_MODULE_CODE;
      }
      if (id === NOOP_MODULE_ID + ":react") {
        return NOOP_REACT_MODULE_CODE;
      }
      return null;
    },
  };
}
