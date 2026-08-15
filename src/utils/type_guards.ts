/**
 * Type Guards & Utilities — Improve type safety
 *
 * Provides:
 *   • Runtime type validation
 *   • Narrowing helpers
 *   • Exhaustive checks
 *   • Safe type assertions
 */

// ── Basic Guards ─────────────────────────────────────────────────────────────

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isFunction(value: unknown): value is Function {
  return typeof value === "function";
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function isNull(value: unknown): value is null {
  return value === null;
}

export function isUndefined(value: unknown): value is undefined {
  return value === undefined;
}

export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

// ── Narrowing Helpers ────────────────────────────────────────────────────────

/**
 * Type-safe switch exhaustiveness check
 *
 * @example
 * ```typescript
 * switch (kind) {
 *   case "a": return handleA();
 *   case "b": return handleB();
 *   default: return assertNever(kind);
 * }
 * ```
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${value}`);
}

/**
 * Assert condition at runtime
 */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Assert value is defined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  name: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${name} to be defined`);
  }
}

// ── Error Type Guards ────────────────────────────────────────────────────────

export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

export function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return isError(value) && "code" in value;
}

export function isDyadError(value: unknown): value is Error & { kind: string } {
  return isError(value) && "kind" in value;
}

// ── Promise Guards ───────────────────────────────────────────────────────────

export function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return value !== null && typeof value === "object" && "then" in value;
}

// ── Object Property Guards ──────────────────────────────────────────────────

export function hasProperty<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}

export function hasStringProperty<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, string> {
  return hasProperty(obj, key) && isString(obj[key]);
}

export function hasNumberProperty<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, number> {
  return hasProperty(obj, key) && isNumber(obj[key]);
}

// ── Array Guards ─────────────────────────────────────────────────────────────

export function isNonEmptyArray<T>(value: T[]): value is [T, ...T[]] {
  return value.length > 0;
}

export function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return isArray(value) && value.every(guard);
}

// ── Record Guards ────────────────────────────────────────────────────────────

export function isRecordOf<K extends string | number, V>(
  value: unknown,
  keyGuard: (key: unknown) => key is K,
  valueGuard: (value: unknown) => value is V,
): value is Record<K, V> {
  if (!isObject(value)) return false;

  return Object.entries(value).every(([k, v]) => keyGuard(k) && valueGuard(v));
}

// ── Safe Casting ─────────────────────────────────────────────────────────────

/**
 * Cast with runtime validation
 */
export function cast<T>(
  value: unknown,
  guard: (value: unknown) => value is T,
  errorMessage?: string,
): T {
  if (!guard(value)) {
    throw new Error(errorMessage || "Type cast failed");
  }
  return value;
}

/**
 * Cast or return default
 */
export function castOrDefault<T>(
  value: unknown,
  guard: (value: unknown) => value is T,
  defaultValue: T,
): T {
  return guard(value) ? value : defaultValue;
}

/**
 * Safe JSON parse with validation
 */
export function parseJSON<T>(
  json: string,
  guard: (value: unknown) => value is T,
): T | null {
  try {
    const parsed = JSON.parse(json);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ── Exhaustive Check ─────────────────────────────────────────────────────────

/**
 * Compile-time exhaustive check for discriminated unions
 *
 * @example
 * ```typescript
 * type Shape = { kind: "circle"; radius: number } | { kind: "square"; size: number };
 *
 * function area(shape: Shape): number {
 *   switch (shape.kind) {
 *     case "circle": return Math.PI * shape.radius ** 2;
 *     case "square": return shape.size ** 2;
 *     default: return exhaustive(shape);
 *   }
 * }
 * ```
 */
export function exhaustive(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
