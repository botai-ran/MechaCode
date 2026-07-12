import path from "node:path";

import { ToolInputError } from "../core/errors.js";
import type {
  AgentTool,
  RuntimeCapabilitySnapshot,
  ToolPermissionCategory,
  ToolPolicyDecision
} from "../core/types.js";

/** 阶段 0 默认拒绝策略的稳定版本号，便于日志和测试对齐。 */
export const DEFAULT_SECURITY_POLICY_VERSION = "default-deny-v0";

/** 默认安全能力：只允许工作区内非敏感读取，高风险能力全部关闭。 */
export const DEFAULT_SECURITY_SNAPSHOT: RuntimeCapabilitySnapshot = {
  mode: "default_deny",
  policyVersion: DEFAULT_SECURITY_POLICY_VERSION,
  read: true,
  write: false,
  command: false,
  network: false,
  sensitiveFileProtection: true
};

/** 敏感目录名，任何路径段命中都拒绝被工具读取、搜索或写入。 */
const SENSITIVE_DIRECTORY_NAMES = new Set([
  ".aws",
  ".azure",
  ".config/gcloud",
  ".docker",
  ".gnupg",
  ".ssh"
]);

/** 敏感文件名或后缀规则，覆盖常见密钥、环境变量和凭据文件。 */
const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /^id_(?:dsa|ecdsa|ed25519|rsa)(?:\.pub)?$/i,
  /(?:^|[._-])credential(?:s)?(?:[._-]|$)/i,
  /(?:^|[._-])secret(?:s)?(?:[._-]|$)/i,
  /(?:^|[._-])token(?:s)?(?:[._-]|$)/i,
  /\.(?:key|pem|p12|pfx)$/i
];

/**
 * 创建一次 Run 使用的能力快照。
 *
 * @param snapshot 外部传入的部分能力配置。
 * @returns 已补齐默认拒绝值的新对象，调用方可以安全冻结或记录。
 */
export function createRuntimeSecuritySnapshot(
  snapshot: Partial<RuntimeCapabilitySnapshot> = {}
): RuntimeCapabilitySnapshot {
  return {
    ...DEFAULT_SECURITY_SNAPSHOT,
    ...snapshot
  };
}

/**
 * 给工具执行入口包上一层策略复验。
 *
 * @param tool 原始工具实现。
 * @param snapshot 本轮冻结的安全能力快照。
 * @returns 复验后再执行的工具。
 */
export function createPolicyGuardedTool<I, O>(
  tool: AgentTool<I, O>,
  snapshot: RuntimeCapabilitySnapshot
): AgentTool<I, O> {
  return {
    ...tool,
    async run(input: I): Promise<O> {
      const decision = evaluateToolPolicy(tool, input, snapshot);

      if (decision.status === "denied") {
        throw new ToolInputError(decision.message);
      }

      return tool.run(input);
    }
  };
}

/**
 * 执行前评估工具调用是否符合当前安全快照。
 *
 * @param tool 待执行工具。
 * @param input 工具入参。
 * @param snapshot Run 开始时冻结的能力快照。
 * @returns 可展示给 UI 或测试断言的策略决策。
 */
export function evaluateToolPolicy(
  tool: Pick<AgentTool, "name" | "permission">,
  input: unknown,
  snapshot: RuntimeCapabilitySnapshot
): ToolPolicyDecision {
  const permissionDecision = evaluatePermission(tool.permission, snapshot);

  if (permissionDecision.status === "denied") {
    return permissionDecision;
  }

  if (snapshot.sensitiveFileProtection) {
    const sensitivePath = findSensitivePath(tool.name, input);
    if (sensitivePath) {
      return {
        status: "denied",
        permission: tool.permission,
        code: "SENSITIVE_PATH_DENIED",
        message: `安全策略已拒绝访问敏感路径：${sensitivePath}`
      };
    }
  }

  return {
    status: "allowed",
    permission: tool.permission,
    code: "ALLOWED",
    message: "安全策略允许本次工具调用。"
  };
}

function evaluatePermission(
  permission: ToolPermissionCategory,
  snapshot: RuntimeCapabilitySnapshot
): ToolPolicyDecision {
  if (snapshot[permission]) {
    return {
      status: "allowed",
      permission,
      code: "ALLOWED",
      message: "安全策略允许本次工具调用。"
    };
  }

  const labels: Record<ToolPermissionCategory, string> = {
    command: "命令执行",
    network: "工具网络访问",
    read: "读取",
    write: "写入"
  };

  return {
    status: "denied",
    permission,
    code: `CAPABILITY_${permission.toUpperCase()}_DENIED`,
    message: `默认安全策略已拒绝${labels[permission]}能力。`
  };
}

function findSensitivePath(toolName: string, input: unknown): string | null {
  if (toolName === "git_diff" && !hasPathInput(input)) {
    return "全仓库 diff";
  }

  if (!hasPathInput(input)) {
    return null;
  }

  return isSensitiveWorkspacePath(input.path) ? input.path : null;
}

function hasPathInput(input: unknown): input is { path: string } {
  return (
    input !== null &&
    typeof input === "object" &&
    typeof (input as { path?: unknown }).path === "string"
  );
}

/**
 * 判断工作区相对路径是否命中敏感文件或凭据目录规则。
 *
 * @param requestedPath 用户或模型传入的工作区路径。
 * @returns 命中敏感规则时返回 true。
 */
export function isSensitiveWorkspacePath(requestedPath: string): boolean {
  const normalized = requestedPath
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .join("/");
  const lower = normalized.toLowerCase();

  if (SENSITIVE_DIRECTORY_NAMES.has(lower)) {
    return true;
  }

  const segments = lower.split("/");
  if (
    segments.some((_, index) =>
      SENSITIVE_DIRECTORY_NAMES.has(segments.slice(0, index + 1).join("/"))
    )
  ) {
    return true;
  }

  const basename = path.posix.basename(lower);
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(basename));
}
