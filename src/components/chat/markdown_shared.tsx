/**
 * Shared markdown plumbing — a leaf module so neither DyadMarkdownParser nor
 * VanillaMarkdownParser has to import render helpers through each other
 * (which caused a module evaluation-order ReferenceError in dev).
 */
import { type ComponentProps } from "react";
import remarkGfm from "remark-gfm";
import { CodeHighlight } from "./CodeHighlight";
import { ipc } from "@/ipc/types";

export const customLink = ({
  node: _node,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) => (
  <a
    {...props}
    target="_blank"
    rel="noopener noreferrer"
    onClick={(e) => {
      const url = props.href;
      if (url) {
        e.preventDefault();
        ipc.instructions.openExternalUrl(url);
      }
    }}
  />
);

// Module-level constants so memoized parsers never get fresh refs for these
// props, which would defeat ReactMarkdown's internal prop-equality checks.
export const REMARK_PLUGINS = [remarkGfm];
export const MARKDOWN_COMPONENTS = { code: CodeHighlight, a: customLink };
