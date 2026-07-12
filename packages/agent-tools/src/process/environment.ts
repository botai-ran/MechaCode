/** 允许传给工具子进程的环境变量名，按大小写不敏感匹配。 */
const PROCESS_ENV_ALLOWLIST = new Set([
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMSPEC",
  "HOME",
  "LANG",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PSMODULEPATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR"
]);

/** 疑似秘密、凭据或代理认证的环境变量名片段。 */
const SECRET_ENV_NAME_PARTS = [
  "API_KEY",
  "AUTH",
  "CREDENTIAL",
  "GIT_ASKPASS",
  "KEY",
  "PASSWORD",
  "PROXY",
  "SECRET",
  "SSH_ASKPASS",
  "TOKEN"
];

/**
 * 根据显式 allowlist 构造工具子进程环境。
 *
 * @param sourceEnv 父进程环境；默认取当前进程环境。
 * @returns 已移除 provider key、代理凭据、Git 凭据和疑似秘密的新环境对象。
 */
export function createSafeProcessEnv(
  sourceEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(sourceEnv)) {
    if (value === undefined || isSensitiveEnvName(name)) {
      continue;
    }

    if (PROCESS_ENV_ALLOWLIST.has(name.toUpperCase())) {
      safeEnv[name] = value;
    }
  }

  return safeEnv;
}

function isSensitiveEnvName(name: string): boolean {
  const upperName = name.toUpperCase();
  return SECRET_ENV_NAME_PARTS.some((part) => upperName.includes(part));
}
