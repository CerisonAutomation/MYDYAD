/**
 * Batch Executor Tool - Parallel task execution with dependency resolution
 *
 * Features:
 * - Execute multiple operations in parallel
 * - Dependency graph resolution (topological sort)
 * - Rollback on failure
 * - Progress tracking
 * - Partial success handling
 */

import { z } from "zod";
import * as path from "node:path";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { resolveDirectoryWithinAppPath } from "./path_safety";
import { assertNotPrivateIp } from "./network_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { smartTruncateSafe } from "./text_utils";
import log from "electron-log";

const logger = log.scope("batch_executor");

const batchTaskSchema = z.object({
  id: z.string().describe("Unique task identifier"),
  type: z
    .enum(["read_file", "write_file", "fetch_url", "transform"])
    .describe("Task type"),
  input: z
    .record(z.string(), z.unknown())
    .describe("Task-specific input parameters"),
  depends_on: z
    .array(z.string())
    .optional()
    .describe("Task IDs this task depends on"),
});

const batchExecutorSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to operate on instead of the current app.",
    ),
  tasks: z.array(batchTaskSchema).min(1).max(50).describe("Tasks to execute"),
  concurrency: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe("Max parallel tasks"),
  stop_on_failure: z
    .boolean()
    .optional()
    .default(false)
    .describe("Stop all tasks on first failure"),
  rollback_on_failure: z
    .boolean()
    .optional()
    .default(false)
    .describe("Rollback completed tasks on failure"),
});

const DESCRIPTION = `Execute multiple tasks in parallel with dependency resolution, progress tracking, and optional rollback.

Supported task types:
- read_file: Read file contents
- write_file: Write content to file
- fetch_url: HTTP GET request
- transform: Apply text transformation

Features:
- Dependency graph with topological sort
- Configurable concurrency (1-20)
- Stop-on-failure mode
- Rollback support for write operations
- Partial success handling
- Progress tracking`;

export const batchExecutorTool: ToolDefinition<
  z.infer<typeof batchExecutorSchema>
> = {
  name: "batch_executor",
  description: DESCRIPTION,
  inputSchema: batchExecutorSchema,
  defaultConsent: "ask",
  modifiesState: true,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) =>
    `Execute ${args.tasks.length} batch task(s) with concurrency ${args.concurrency}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-batch-executor task_count="${args.tasks?.length ?? 0}" concurrency="${args.concurrency ?? 5}">Preparing batch...</dyad-batch-executor>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const { tasks, concurrency, stop_on_failure, rollback_on_failure } = args;
    logger.log(
      `Batch executor: ${tasks.length} tasks, concurrency=${concurrency}`,
    );

    ctx.onXmlStream(
      `<dyad-batch-executor task_count="${tasks.length}" completed="0">Resolving dependencies...</dyad-batch-executor>`,
    );

    // Build dependency graph and topological sort
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const completed = new Set<string>();
    const failed = new Set<string>();
    const rolledBack: string[] = [];
    const resolvedPaths = new Map<string, string>();
    const results: Array<{
      id: string;
      status: "success" | "error" | "skipped";
      output?: string;
      error?: string;
    }> = [];

    // Check for missing dependencies
    for (const task of tasks) {
      if (task.depends_on) {
        for (const dep of task.depends_on) {
          if (!taskMap.has(dep)) {
            throw new DyadError(
              `Task "${task.id}" depends on non-existent task "${dep}"`,
              DyadErrorKind.Validation,
            );
          }
        }
      }
    }

    // Check for circular dependencies
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const hasCycle = (taskId: string): boolean => {
      if (inStack.has(taskId)) return true;
      if (visited.has(taskId)) return false;
      visited.add(taskId);
      inStack.add(taskId);
      const task = taskMap.get(taskId);
      if (task?.depends_on) {
        for (const dep of task.depends_on) {
          if (hasCycle(dep)) return true;
        }
      }
      inStack.delete(taskId);
      return false;
    };

    for (const task of tasks) {
      if (hasCycle(task.id)) {
        throw new DyadError(
          `Circular dependency detected involving task "${task.id}"`,
          DyadErrorKind.Validation,
        );
      }
    }

    // Execute tasks with dependency resolution
    const executeTask = async (task: (typeof tasks)[0]): Promise<void> => {
      // Check if dependencies are satisfied
      if (task.depends_on?.some((dep) => failed.has(dep))) {
        results.push({
          id: task.id,
          status: "skipped",
          error: "Dependency failed",
        });
        failed.add(task.id);
        return;
      }

      if (task.depends_on?.some((dep) => !completed.has(dep))) {
        return; // Not ready yet, will be retried
      }

      try {
        let output = "";

        switch (task.type) {
          case "read_file": {
            const fs = await import("node:fs/promises");
            const filePath = task.input.path as string;
            const safeRelative = await resolveDirectoryWithinAppPath({
              appPath: targetAppPath,
              directory: filePath,
            });
            const fullPath = path.join(targetAppPath, safeRelative);
            const content = await fs.readFile(fullPath, "utf-8");
            output = content;
            break;
          }
          case "write_file": {
            const fs = await import("node:fs/promises");
            const filePath = task.input.path as string;
            const safeRelative = await resolveDirectoryWithinAppPath({
              appPath: targetAppPath,
              directory: filePath,
            });
            const fullPath = path.join(targetAppPath, safeRelative);
            await fs.writeFile(fullPath, task.input.content as string);
            resolvedPaths.set(task.id, fullPath);
            output = `Written to ${filePath}`;
            break;
          }
          case "fetch_url": {
            const url = task.input.url as string;
            const parsedUrl = new URL(url);
            if (!["http:", "https:"].includes(parsedUrl.protocol)) {
              throw new DyadError(
                `fetch_url only supports http/https URLs, got: ${parsedUrl.protocol}`,
                DyadErrorKind.Validation,
              );
            }
            assertNotPrivateIp(url);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15_000);
            try {
              const response = await fetch(url, { signal: controller.signal });
              output = smartTruncateSafe(await response.text(), 500_000);
            } finally {
              clearTimeout(timeout);
            }
            break;
          }
          case "transform": {
            const input = task.input.input as string;
            const operation = task.input.operation as string;
            if (operation === "uppercase") output = input.toUpperCase();
            else if (operation === "lowercase") output = input.toLowerCase();
            else if (operation === "reverse")
              output = input.split("").reverse().join("");
            else if (operation === "length") output = String(input.length);
            else output = input;
            break;
          }
        }

        completed.add(task.id);
        output = smartTruncateSafe(output, 500_000);
        results.push({ id: task.id, status: "success", output });

        ctx.onXmlStream(
          `<dyad-batch-executor task_count="${tasks.length}" completed="${completed.size}" failed="${failed.size}">Executing...</dyad-batch-executor>`,
        );
      } catch (error) {
        failed.add(task.id);
        results.push({
          id: task.id,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });

        if (stop_on_failure) {
          throw new DyadError(
            `Batch stopped: task "${task.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
            DyadErrorKind.External,
          );
        }
      }
    };

    // Run with bounded concurrency, respecting dependencies
    const pending = [...tasks];
    const inFlight = new Set<Promise<void>>();

    while (pending.length > 0 || inFlight.size > 0) {
      // Find tasks whose dependencies are met
      const ready = pending.filter((t) => {
        if (
          t.depends_on?.some((dep) => !completed.has(dep) && !failed.has(dep))
        )
          return false;
        return true;
      });

      // Execute ready tasks
      for (const task of ready) {
        pending.splice(pending.indexOf(task), 1);

        const promise = executeTask(task).then(() => {
          inFlight.delete(promise);
        });
        inFlight.add(promise);

        if (inFlight.size >= concurrency) {
          await Promise.race(inFlight);
        }
      }

      if (ready.length === 0 && inFlight.size > 0) {
        await Promise.race(inFlight);
      } else if (ready.length === 0 && inFlight.size === 0) {
        break; // Deadlock or all done
      }
    }

    await Promise.all(inFlight);

    // Rollback on failure if requested
    if (rollback_on_failure && failed.size > 0) {
      ctx.onXmlStream(
        `<dyad-batch-executor task_count="${tasks.length}" completed="${completed.size}" failed="${failed.size}">Rolling back...</dyad-batch-executor>`,
      );

      const fs = await import("node:fs/promises");
      for (const result of results.reverse()) {
        if (result.status === "success") {
          const task = taskMap.get(result.id);
          if (task?.type === "write_file") {
            try {
              const resolvedPath = resolvedPaths.get(result.id);
              if (resolvedPath) {
                await fs.unlink(resolvedPath);
              }
              rolledBack.push(result.id);
            } catch {
              /* file may not exist */
            }
          }
        }
      }
    }

    // Format results
    const succeeded = results.filter((r) => r.status === "success");
    const errored = results.filter((r) => r.status === "error");
    const skipped = results.filter((r) => r.status === "skipped");

    let resultText = `Batch complete: ${succeeded.length} succeeded, ${errored.length} failed, ${skipped.length} skipped.\n\n`;

    if (succeeded.length > 0) {
      resultText += `## Succeeded\n`;
      for (const r of succeeded) {
        resultText += `- ${r.id}: ${r.output?.slice(0, 200) ?? "OK"}\n`;
      }
    }

    if (errored.length > 0) {
      resultText += `\n## Failed\n`;
      for (const r of errored) {
        resultText += `- ${r.id}: ${r.error}\n`;
      }
    }

    if (rolledBack.length > 0) {
      resultText += `\n## Rolled Back\n${rolledBack.map((id) => `- ${id}`).join("\n")}\n`;
    }

    ctx.onXmlComplete(
      `<dyad-batch-executor succeeded="${succeeded.length}" failed="${errored.length}" skipped="${skipped.length}" rolled_back="${rolledBack.length}">\n${escapeXmlContent(resultText)}\n</dyad-batch-executor>`,
    );

    return resultText;
  },
};
