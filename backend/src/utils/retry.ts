export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  retryableErrors?: (error: Error) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  retryableErrors: (error: Error) => {
    // Retry on network errors, timeouts, and server errors (5xx)
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes(' econn') ||
      message.includes(' enoent') ||
      error.name === 'AbortError'
    );
  },
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries,
    baseDelay,
    maxDelay,
    retryableErrors,
  } = { ...DEFAULT_OPTIONS, ...options };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // Check if we should retry
      if (attempt < maxRetries && retryableErrors(err)) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        const jitter = Math.random() * 0.1 * delay; // 10% jitter
        const totalDelay = delay + jitter;

        console.error(
          `Attempt ${attempt + 1}/${maxRetries} failed: ${err.message}. ` +
          `Retrying in ${Math.round(totalDelay)}ms...`
        );

        await new Promise((resolve) => setTimeout(resolve, Math.round(totalDelay)));
      } else {
        // Don't retry - rethrow immediately
        throw err;
      }
    }
  }

  // Should never reach here, but just in case
  throw lastError || new Error('Retry failed for unknown reason');
}

export function isRetryableError(error: Error): boolean {
  return DEFAULT_OPTIONS.retryableErrors(error);
}
