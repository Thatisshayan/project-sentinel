export interface ErrorInfo {
  message: string;
  stack?: string;
}

export function getErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }

  if (typeof err === 'string') {
    return { message: err };
  }

  return { message: 'Unknown error' };
}
