/** 用于显式表达成功或失败的轻量判别联合类型。 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * 创建一个成功结果。
 *
 * @param value 成功分支携带的值。
 * @returns 标准化的成功结果。
 */
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/**
 * 创建一个失败结果。
 *
 * @param error 失败分支携带的错误信息。
 * @returns 标准化的失败结果。
 */
export const err = <E = Error>(error: E): Result<never, E> => ({
  ok: false,
  error
});
