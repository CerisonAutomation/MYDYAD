# Comet Agent Patterns — Extracted & Improved

**Source:** Comet.app (Perplexity) v0.0.224 extraction
**Date:** 2026-08-19
**Purpose:** Patterns to improve dyad-main's agent capabilities

---

## 1. Task Management Pattern

Comet uses a **task-centric model** where each user interaction creates a task (thread) with lifecycle management.

### Key Patterns

```typescript
// Task lifecycle: create → running → pending → sleeping → completed
type TaskStatus = "pending" | "sleeping" | "running" | "completed" | "error";

interface CometTask {
  contextUUID: string;        // Unique task identifier
  entryUUID: string;          // Current entry in the task
  slug: string;               // URL-friendly identifier
  title: string;              // Auto-generated or user-provided
  displayModel: string;       // Which AI model is handling this
  threadStatus: TaskStatus;   // Current lifecycle state
  statusSummary: string;      // Human-readable status
  preview: string;            // Quick preview of latest response
  wakeAt?: number;            // When to wake from sleep (cron-like)
  unread: boolean;            // Has new content
  assets: Asset[];            // Generated files/code/charts
}
```

### What We Should Adopt

1. **Task-centric interaction model** — Every chat interaction creates a trackable task
2. **Sleeping/wake pattern** — Tasks can "sleep" and be woken by cron or user action
3. **Asset tracking** — Generated code, files, charts are tracked per-task
4. **Blocking questions** — Tasks can pause waiting for user input

---

## 2. Voice Session Pattern

Comet has a sophisticated voice agent system with real-time streaming.

### Key Patterns

```typescript
// Voice session states
type VoiceConnectionState = "disconnected" | "connecting" | "connected" | "error";
type VoiceThinkingStatus = "idle" | "thinking" | "speaking";

// Voice actions available to the agent
interface ComputerVoiceActions {
  getTasks: () => CometTask[];
  getTask: (id: string) => CometTask | undefined;
  findTaskByTitle: (title: string) => CometTask | undefined;
  getCurrentView: () => { type: "thread" | "landing" | "home"; threadSlug?: string; threadId?: string };
  getAssets: () => Asset[];
  navigate: (action: NavigationAction) => string;
  createTask: (query: string, navigate?: boolean) => string;
  sendFollowup: (query: string, contextUuid?: string) => string;
  cancelTask: (id: string) => Promise<boolean>;
  reconnectStream: (callback: () => void) => void;
  getBlockedFollowups: (contextUuid?: string) => Promise<BlockedFollowup[]>;
  getThreadContent: () => string;
  getThreadContentById: (id: string) => Promise<string>;
}
```

### What We Should Adopt

1. **Rich voice actions** — Give the voice agent access to task management, navigation, and content
2. **Thread content streaming** — Real-time content updates during agent execution
3. **Blocked followups** — Tasks can pause waiting for user answers to specific questions

---

## 3. Workflow Pattern

Comet uses a workflow system for multi-step agent operations.

### Key Patterns

```typescript
// Workflow steps
interface WorkflowStep {
  status: "WORKFLOW_AWAITING_USER" | "WORKFLOW_RUNNING" | "WORKFLOW_COMPLETED";
  items: WorkflowItem[];
}

// Workflow items
type WorkflowItemType = 
  | "WORKFLOW_ITEM_TEXT"           // Text output
  | "WORKFLOW_ITEM_USER_QUESTIONS" // Questions for the user
  | "WORKFLOW_ITEM_CODE"           // Code output
  | "WORKFLOW_ITEM_FILE";          // File output

// Pending followups (agent-initiated questions)
interface PendingFollowup {
  uuid: string;
  text: string;
  status: "FOLLOWUP_STATUS_PENDING" | "FOLLOWUP_STATUS_COMMITTED" | "FOLLOWUP_STATUS_CANCELED";
}
```

### What We Should Adopt

1. **Structured workflows** — Multi-step operations with clear status tracking
2. **User question items** — Formalized way for agents to ask questions
3. **Pending followups** — Agent can suggest follow-up actions

---

## 4. Navigation Action Pattern

Comet agents can navigate the UI programmatically.

```typescript
type NavigationAction = 
  | { action: "home" }
  | { action: "close_asset" }
  | { action: "open_asset"; uuid: string }
  | { action: "open_thread"; context_uuid: string; title?: string };
```

### What We Should Adopt

1. **Agent-initiated navigation** — Agents can open/close views, navigate to specific content
2. **Asset opening** — Agents can open generated files for user review

---

## 5. Thread Content Extraction Pattern

Comet extracts structured content from threads for agent context.

```typescript
// Content extraction from workflow blocks
function extractThreadContent(entries: ThreadEntry[]): string {
  const parts: string[] = [];
  
  for (const entry of entries) {
    // Add user query
    if (entry.query_str) {
      const preview = entry.query_str.length > 200 
        ? entry.query_str.slice(0, 200) + "…"
        : entry.query_str;
      parts.push(`User: "${preview}"`);
    }
    
    if (!entry.blocks) continue;
    
    for (const block of entry.blocks) {
      if (block.intended_usage === "workflow_root") {
        for (const step of block.workflow_block?.steps ?? []) {
          // Add step status and title
          if (step.title) {
            parts.push(`[${step.status ?? ""}] ${step.title}`);
          }
          
          // Extract items
          for (const item of step.items ?? []) {
            if (item.type === "WORKFLOW_ITEM_TEXT" && item.payload?.text_payload?.text) {
              parts.push(item.payload.text_payload.text);
            }
            if (item.type === "WORKFLOW_ITEM_USER_QUESTIONS") {
              for (const field of item.payload?.user_questions_payload?.fields ?? []) {
                if (field.field_name) {
                  parts.push(`Question: "${field.field_name}"`);
                  const options = (field.options ?? [])
                    .filter(o => !o.is_free_text_selection && o.title)
                    .map(o => `"${o.title}"`);
                  if (options.length > 0) {
                    parts.push(`Options: ${options.join(", ")}`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  
  return parts.length > 0 ? parts.join("\n") : "";
}
```

### What We Should Adopt

1. **Structured content extraction** — Parse workflow blocks into readable context
2. **Step status tracking** — Show which steps are pending/running/completed
3. **Question extraction** — Formalized way to present options to users

---

## 6. Event Blocking Pattern

Comet blocks user input during agent autonomous operations.

```typescript
// Events blocked during agent operation
const BLOCKED_EVENTS = [
  "click", "dblclick", "mousedown", "mouseup",
  "mouseenter", "mouseleave", "mousemove", "mouseout", "mouseover",
  "mousewheel", "wheel",
  "touchstart", "touchend", "touchmove", "touchcancel",
  "keydown", "keyup", "keypress",
  "beforeinput", "input", "textInput",
  "compositionstart", "compositionend", "compositionupdate",
  "pointercancel", "pointerdown", "pointerenter", "pointerleave",
  "pointermove", "pointerout", "pointerover", "pointerrawupdate", "pointerup",
  "drag", "dragend", "dragenter", "dragleave", "dragover", "dragstart", "drop",
  "selectstart", "contextmenu", "change", "beforetoggle", "submit", "reset"
];

// CSS cursor override during blocking
const CURSOR_STYLE = `
  html body *, html body *::before, html body *::after {
    cursor: progress !important;
  }
  html body [data-agent-overlay], html body [data-agent-overlay] * {
    cursor: pointer !important;
  }
`;
```

### What We Should Adopt

1. **Complete event blocking** — Block all user input during autonomous operations
2. **Cursor override** — Show progress cursor to indicate agent is working
3. **Overlay exception** — Allow interaction with agent overlay controls

---

## 7. MCP Server Management Pattern

Comet manages MCP (Model Context Protocol) servers for tool access.

```typescript
// MCP server management
interface MCPServer {
  id: string;
  name: string;
  url: string;
  status: "connected" | "disconnected" | "error";
  tools: MCPTool[];
}

// MCP tool definition
interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  serverId: string;
}
```

### What We Should Adopt

1. **MCP server registry** — Track connected MCP servers and their tools
2. **Tool discovery** — Automatically discover available tools from MCP servers
3. **Server status monitoring** — Track connection health

---

## 8. DXT Package Management Pattern

Comet supports DXT (Desktop Extension) packages for extending agent capabilities.

```typescript
// DXT package structure
interface DXTPackage {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  tools: MCPTool[];
  enabled: boolean;
}
```

### What We Should Adopt

1. **Plugin architecture** — Allow third-party extensions via DXT packages
2. **Permission system** — Control what extensions can access
3. **Tool registration** — Extensions can register new tools

---

## 9. Overlay UI Pattern

Comet has a sophisticated overlay system for agent status.

### Key Components

1. **Animated gradient border** — Shows agent is active
2. **Progress indicators** — Step-by-step progress
3. **Pause/Resume controls** — User can pause agent operations
4. **Cancel button** — User can cancel agent operations
5. **Auto-hide** — Overlay hides after task completion

### What We Should Adopt

1. **Animated visual feedback** — Gradient border for active state
2. **Step-by-step progress** — Show individual step completion
3. **User controls** — Pause, resume, cancel capabilities
4. **Smart auto-hide** — Hide after completion with configurable delay

---

## 10. Sentry Integration Pattern

Comet uses Sentry for error tracking and monitoring.

```typescript
// Sentry configuration
const SENTRY_CONFIG = {
  dsn: "...",
  environment: "production",
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
};
```

### What We Should Adopt

1. **Error tracking** — Capture and report agent errors
2. **Performance monitoring** — Track agent operation performance
3. **Session replay** — Record agent sessions for debugging

---

## Implementation Priority

### High Priority (Immediate)
1. ✅ Event blocking (already implemented in agent_overlay/eventBlocker.ts)
2. ✅ Overlay UI (already implemented in agent_overlay/)
3. Task-centric interaction model
4. Structured workflow system

### Medium Priority (Next Sprint)
5. Voice session pattern
6. Navigation actions
7. Thread content extraction
8. MCP server management

### Low Priority (Future)
9. DXT package management
10. Sentry integration
11. Session replay

---

## Code Examples for Integration

### Task Manager

```typescript
// src/agent_overlay/taskManager.ts
interface ManagedTask {
  id: string;
  title: string;
  status: "pending" | "running" | "sleeping" | "completed" | "error";
  steps: ManagedStep[];
  assets: ManagedAsset[];
  blockedFollowups: BlockedFollowup[];
  createdAt: number;
  updatedAt: number;
}

class TaskManager {
  private tasks = new Map<string, ManagedTask>();
  
  createTask(title: string): ManagedTask { ... }
  updateTask(id: string, updates: Partial<ManagedTask>): void { ... }
  completeTask(id: string): void { ... }
  sleepTask(id: string, wakeAt: number): void { ... }
  wakeTask(id: string): void { ... }
  addBlockedFollowup(taskId: string, followup: BlockedFollowup): void { ... }
  resolveBlockedFollowup(taskId: string, followupId: string, answer: string): void { ... }
}
```

### Workflow Engine

```typescript
// src/agent_overlay/workflow.ts
interface WorkflowStep {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  items: WorkflowItem[];
}

interface WorkflowItem {
  type: "text" | "code" | "file" | "question";
  payload: unknown;
}

class WorkflowEngine {
  private workflows = new Map<string, WorkflowStep[]>();
  
  createWorkflow(taskId: string, steps: WorkflowStep[]): void { ... }
  updateStepStatus(taskId: string, stepId: string, status: string): void { ... }
  addItem(taskId: string, stepId: string, item: WorkflowItem): void { ... }
  getWorkflowContent(taskId: string): string { ... }
}
```

---

*Extracted from Comet.app v0.0.224 — patterns adapted for dyad-main architecture*
