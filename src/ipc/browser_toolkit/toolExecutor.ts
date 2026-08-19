export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}
export class ToolExecutor {
  private zenith: unknown;
  constructor(zenith?: unknown) {
    this.zenith = zenith;
  }
  async execute(_tool: ToolCall): Promise<string> {
    return "Tool execution not available";
  }
}
