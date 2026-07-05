import { ToolInputError } from "../core/errors.js";

export function assertPlainObject(value: unknown, label: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError(`${label} 必须是对象。`);
  }
}
