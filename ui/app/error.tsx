"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-lg rounded-xl border border-s-red/40 bg-s-red/10 p-6 text-center">
        <div className="text-sm font-semibold text-s-red">Dashboard error</div>
        <p className="mt-3 text-sm text-s-muted">
          The page hit an unexpected error. Retry after the backend recovers, or refresh the page.
        </p>
        <button
          onClick={reset}
          className="mt-5 rounded-md border border-s-border px-3 py-1.5 text-sm text-s-text hover:bg-white/5"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
