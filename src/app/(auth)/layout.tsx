export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-xl font-semibold tracking-tight text-foreground">
            M<span className="text-brand">&amp;</span>N FieldOps
          </div>
          <div className="text-sm text-muted-foreground">Manpower and scheduling</div>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
