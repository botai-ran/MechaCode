/** 工具输出中用于替代疑似秘密的固定占位。 */
const REDACTION_TEXT = "[已脱敏]";

/** 常见 provider key、canary secret、凭据赋值和长 token 的保守匹配规则。 */
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bMECHACODE_CANARY_[A-Za-z0-9_-]+\b/g,
  /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*([^\s"'`]+)/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
];

/**
 * 对工具输出、错误详情和诊断文本执行统一秘密脱敏。
 *
 * @param value 待返回给模型、UI 或日志的文本。
 * @returns 已替换疑似秘密后的文本。
 */
export function redactSecrets(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce(
    (output, pattern) =>
      output.replace(pattern, (match) => {
        const assignment = match.match(/^([^=]+)=/);
        return assignment ? `${assignment[1]}=${REDACTION_TEXT}` : REDACTION_TEXT;
      }),
    value
  );
}
