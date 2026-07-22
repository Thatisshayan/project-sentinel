interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
}

/**
 * Retries an async operation with exponential backoff (baseDelay * 2^attempt).
 * Rejects with the last error once maxRetries is exhausted.
 */
async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxRetries, baseDelay } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export { retryWithBackoff };
