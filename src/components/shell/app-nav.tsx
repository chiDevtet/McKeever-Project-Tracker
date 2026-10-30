"use client";

import { BarChart3, CalendarRange, ClipboardCheck, FileText, FolderKanban, LayoutDashboard, LogOut, Menu, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme/theme";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export interface Branding {
  appName: string;
  companyName: string;
  logoUrl: string | null;
}

interface NavProps {
  branding: Branding;
  userName: string;
  lastProjectId: string | null;
}

function projectFromPath(pathname: string): string | null {
  const m = /^\/projects\/([^/]+)/.exec(pathname);
  return m && m[1] !== "new" ? m[1] : null;
}

function Wordmark({ branding }: { branding: Branding }) {
  return (
    <Link href="/" className="block px-4 py-4">
      {branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, access-checked file route
        <img src={branding.logoUrl} alt={branding.companyName} className="mb-1 max-h-10 max-w-[10rem] object-contain" />
      ) : null}
      <div className="text-base font-semibold tracking-tight text-white">{branding.appName}</div>
      <div className="text-xs text-nav-muted">{branding.companyName}</div>
    </Link>
  );
}

function NavLinks({ lastProjectId, onNavigate }: { lastProjectId: string | null; onNavigate?: () => void }) {
  const pathname = usePathname();
  const projectId = projectFromPath(pathname) ?? lastProjectId;
  const projectHref = (section: string) => (projectId ? `/projects/${projectId}/${section}` : `/projects?need=${section}`);
  const items = [
    { href: "/", label: "Division dashboard", icon: LayoutDashboard, active: pathname === "/" },
    { href: "/projects", label: "Projects", icon: FolderKanban, active: pathname === "/projects" || pathname.endsWith("/setup") || pathname.endsWith("/plans") || pathname.includes("/imports") },
    { href: projectHref("schedule"), label: "Schedule", icon: CalendarRange, active: pathname.endsWith("/schedule") },
    { href: projectHref("manpower"), label: "Manpower", icon: BarChart3, active: pathname.endsWith("/manpower") },
    { href: projectHref("progress"), label: "Progress", icon: ClipboardCheck, active: pathname.endsWith("/progress") },
    { href: projectHref("reports"), label: "Reports", icon: FileText, active: pathname.endsWith("/reports") },
    { href: "/people", label: "People", icon: Users, active: pathname.startsWith("/people") },
    { href: "/settings", label: "Settings", icon: Settings, active: pathname.startsWith("/settings") },
  ];
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
      {items.map((it) => (
        <Link
          key={it.label}
          href={it.href}
          onClick={onNavigate}
          aria-current={it.active ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-nav-foreground/85 hover:bg-white/10 hover:text-white",
            it.active && "bg-white/12 font-medium text-white shadow-[inset_3px_0_0_var(--brand-on-nav)]",
          )}
        >
          <it.icon className="size-4 shrink-0" aria-hidden />
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

function UserBlock({ userName }: { userName: string }) {
  const router = useRouter();
  return (
    <div className="space-y-2 border-t border-white/10 px-4 py-3">
      <ThemeToggle variant="nav" />
      <div className="truncate text-sm text-white">{userName}</div>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 text-xs text-nav-muted hover:text-white"
        onClick={async () => {
          await authClient.signOut();
          router.replace("/login");
          router.refresh();
        }}
      >
        <LogOut className="size-3.5" aria-hidden /> Sign out
      </button>
    </div>
  );
}

export function AppSidebar(props: NavProps) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col bg-nav lg:flex">
      <Wordmark branding={props.branding} />
      <div className="flex-1 overflow-y-auto">
        <NavLinks lastProjectId={props.lastProjectId} />
      </div>
      <UserBlock userName={props.userName} />
    </aside>
  );
}

export function MobileTopBar(props: NavProps) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between bg-nav px-3 py-2 lg:hidden">
      <Link href="/" className="text-sm font-semibold text-white">
        {props.branding.appName}
      </Link>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button type="button" className="rounded p-1.5 text-white hover:bg-white/10" aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 border-0 bg-nav p-0 text-nav-foreground">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Wordmark branding={props.branding} />
          <NavLinks lastProjectId={props.lastProjectId} onNavigate={() => setOpen(false)} />
          <UserBlock userName={props.userName} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
