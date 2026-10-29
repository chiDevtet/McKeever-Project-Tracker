"use client";

import { ErrorState } from "@/components/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-6">
      <ErrorState title="This page could not be loaded" message={error.message.includes("not found") ? error.message : "The server could not complete the request. Your saved data is unchanged."} onRetry={reset} />
    </div>
  );
}
