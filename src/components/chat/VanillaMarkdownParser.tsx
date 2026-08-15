import React, { type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
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

export const VanillaMarkdownParser = ({ content }: { content: string }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: CodeHighlight,
        a: customLink,
      }}
    >
      {content}
    </ReactMarkdown>
  );
};
