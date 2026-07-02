/** Agent 可调用工具的统一接口。 */
export interface AgentTool<I = unknown, O = unknown> {
  /** 工具名称，用于注册和查找。 */
  name: string;
  /** 面向模型或调用方的工具能力说明。 */
  description: string;
  /**
   * 执行工具逻辑。
   *
   * @param input 工具输入。
   * @returns 工具输出。
   */
  run(input: I): Promise<O>;
}

/** 按名称注册和解析 Agent 工具的轻量注册表。 */
export class ToolRegistry {
  /** 已注册工具的内部索引。 */
  private readonly tools = new Map<string, AgentTool>();

  /**
   * 注册或覆盖一个工具。
   *
   * @param tool 待注册的工具实例。
   */
  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 按名称查找工具。
   *
   * @param name 工具名称。
   * @returns 找到的工具；不存在时返回 `undefined`。
   */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }
}
