import { createWorkspaceTools } from "../tools/index.js";
import {
  createPolicyGuardedTool,
  createRuntimeSecuritySnapshot
} from "../security/policy.js";
import type {
  AgentTool,
  RuntimeCapabilitySnapshot,
  WorkspaceToolOptions
} from "./types.js";

/** 以工具名为键的轻量注册表。 */
export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  private readonly securitySnapshot: RuntimeCapabilitySnapshot;

  /**
   * 创建工具注册表。
   *
   * @param securitySnapshot 本注册表内所有工具执行时使用的冻结安全快照。
   */
  constructor(securitySnapshot?: Partial<RuntimeCapabilitySnapshot>) {
    this.securitySnapshot = createRuntimeSecuritySnapshot(securitySnapshot);
  }

  /** 注册或覆盖一个工具。 */
  register(tool: AgentTool): void {
    this.tools.set(
      tool.name,
      createPolicyGuardedTool(tool, this.securitySnapshot)
    );
  }

  /** 一次注册多个工具。 */
  registerMany(tools: AgentTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** 按名称查找工具。 */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /** 获取当前已注册的工具快照。 */
  list(): AgentTool[] {
    return [...this.tools.values()];
  }
}

/** 创建包含默认工作区工具的注册表。 */
export function createDefaultToolRegistry(
  options: WorkspaceToolOptions
): ToolRegistry {
  const registry = new ToolRegistry(options.securitySnapshot);
  registry.registerMany(createWorkspaceTools(options));
  return registry;
}
