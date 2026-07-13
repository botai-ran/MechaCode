import { createWorkspaceTools } from "../tools/index.js";
import {
  createPolicyGuardedTool,
  createRuntimeSecuritySnapshot,
  evaluateToolPolicy
} from "../security/policy.js";
import type {
  AgentTool,
  RuntimeCapabilitySnapshot,
  ToolPolicyDecision,
  WorkspaceToolOptions
} from "./types.js";

/** 以工具名为键的轻量注册表。 */
export class ToolRegistry {
  private readonly rawTools = new Map<string, AgentTool>();
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
    this.rawTools.set(tool.name, tool);
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

  /** 按名称查找未经策略包装的工具；只允许 Runtime 在单次审批通过后调用。 */
  getApproved(name: string): AgentTool | undefined {
    return this.rawTools.get(name);
  }

  /** 对某次工具调用执行当前安全策略评估，不产生副作用。 */
  evaluate(name: string, input: unknown): ToolPolicyDecision | null {
    const tool = this.rawTools.get(name);

    return tool ? evaluateToolPolicy(tool, input, this.securitySnapshot) : null;
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
