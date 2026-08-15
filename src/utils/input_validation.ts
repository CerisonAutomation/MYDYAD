/**
 * Input Validation Utilities
 *
 * Provides Zod-based validation for API inputs and user data.
 * Prevents injection attacks and ensures data integrity.
 */

import { z } from "zod";

// ============================================================================
// Common Schemas
// ============================================================================

/** Email validation */
export const EmailSchema = z.string().email("Invalid email address");

/** URL validation */
export const UrlSchema = z.string().url("Invalid URL");

/** Non-empty string */
export const NonEmptyStringSchema = z.string().min(1, "String cannot be empty");

/** Positive integer */
export const PositiveIntSchema = z
  .number()
  .int()
  .positive("Must be a positive integer");

/** UUID */
export const UuidSchema = z.string().uuid("Invalid UUID");

// ============================================================================
// API Input Schemas
// ============================================================================

/** Chat message input */
export const ChatMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  role: z.enum(["user", "assistant", "system"]),
  timestamp: z.number().optional(),
});

/** File path input */
export const FilePathSchema = z
  .string()
  .refine(
    (path) => !path.includes("..") && !path.startsWith("/"),
    "Invalid file path",
  );

/** Search query */
export const SearchQuerySchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(100).default(10),
  offset: z.number().int().min(0).default(0),
});

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate input against a schema
 * Returns validated data or throws error
 */
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Safe validation - returns result object
 */
export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Sanitize string input (remove potential XSS)
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Validate and sanitize string input
 */
export function validateAndSanitize(
  schema: z.ZodSchema<string>,
  input: unknown,
): string {
  const validated = validateInput(schema, input);
  return sanitizeString(validated);
}
