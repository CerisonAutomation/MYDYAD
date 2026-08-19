import type { ReactNode } from "react";
import type { Components as ReactMarkdownComponents } from "react-markdown";
import type { DyadTagNode } from "./stateTypes";

// Extend the ReactMarkdown Components type to include our custom components
declare module "react-markdown" {
  interface Components extends ReactMarkdownComponents {
    "dyad-write"?: (props: {
      children?: ReactNode;
      node?: DyadTagNode;
      path?: string;
      description?: string;
    }) => JSX.Element;
    "dyad-rename"?: (props: {
      children?: ReactNode;
      node?: DyadTagNode;
      from?: string;
      to?: string;
    }) => JSX.Element;
    "dyad-delete"?: (props: {
      children?: ReactNode;
      node?: DyadTagNode;
      path?: string;
    }) => JSX.Element;
    "dyad-add-dependency"?: (props: {
      children?: ReactNode;
      node?: DyadTagNode;
      package?: string;
    }) => JSX.Element;
  }
}
