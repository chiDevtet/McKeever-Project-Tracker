import Link from "next/link";

/** Shown for missing records and for projects the viewer cannot access (indistinguishable by design). */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-md space-y-3 p-8 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">This page does not exist, or you do not have access to it. Ask an administrator if you need access to a project.</p>
      <Link href="/" className="text-sm underline">
        Go to the division dashboard
      </Link>
    </main>
  );
}
