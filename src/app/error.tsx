"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

/** Route-level error boundary. Shows a recoverable message instead of the
 *  Next.js default, and reports the digest so an operator can find the log. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[boundary]", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/10 text-danger">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <h1 className="mt-6 text-xl font-bold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        We hit an unexpected problem. Trying again usually clears it.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-[11px] text-muted/70">
          Reference: {error.digest}
        </p>
      )}
      <button onClick={reset} className="btn-primary mt-6">
        <RotateCw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}
