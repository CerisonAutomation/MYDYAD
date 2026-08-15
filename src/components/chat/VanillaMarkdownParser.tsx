import React from "react";
import ReactMarkdown from "react-markdown";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS } from "./markdown_shared";

export const VanillaMarkdownParser = ({ content }: { content: string }) => {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
};
