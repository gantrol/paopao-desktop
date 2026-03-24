export function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || '未知错误');
}
