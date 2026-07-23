"use client";

import { AlertCircle, RotateCcw } from "lucide-react";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--bg-base)] px-4">
      <section className="panel w-full max-w-md p-6 text-center" role="alert">
        <AlertCircle className="mx-auto h-8 w-8 text-[var(--danger)]" aria-hidden />
        <h1 className="mt-3 font-[var(--font-display)] text-lg font-semibold text-[var(--fg)]">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--fg-muted)]">
          The workspace could not finish loading. Try again or return to the previous page.
        </p>
        <button type="button" className="btn-primary mt-5" onClick={reset}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          Try again
        </button>
      </section>
    </main>
  );
}
