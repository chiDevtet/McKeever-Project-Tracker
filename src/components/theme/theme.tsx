"use client";

import { Moon, Sun } from "lucide-react";
import { createContext, useContext, useSyncExternalStore } from "react";
import { THEME_COOKIE, THEME_MAX_AGE, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const InitialTheme = createContext<Theme>("dark");
const listeners = new Set<() => void>();

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Apply and persist an explicit theme choice (cookie for the server, localStorage as a mirror). */
export function setTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the cookie still persists the choice.
  }
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_MAX_AGE}; samesite=lax`;
  for (const l of listeners) l();
}

/** The theme rendered on the server, provided so the first client render matches it. */
export function ThemeProvider({ initial, children }: { initial: Theme; children: React.ReactNode }) {
  return <InitialTheme.Provider value={initial}>{children}</InitialTheme.Provider>;
}

export function useTheme(): Theme {
  const initial = useContext(InitialTheme);
  return useSyncExternalStore(subscribe, readTheme, () => initial);
}

/** Light / Dark segmented control. `nav` styles it for the charcoal navigation. */
export function ThemeToggle({ variant = "default", className }: { variant?: "default" | "nav"; className?: string }) {
  const theme = useTheme();
  const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
  ];
  return (
    <div role="group" aria-label="Color theme" className={cn("inline-flex rounded-md border p-0.5", variant === "nav" ? "border-white/15" : "border-input bg-field", className)}>
      {options.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
              variant === "nav"
                ? active
                  ? "bg-white/15 font-medium text-white"
                  : "text-nav-muted hover:text-white"
                : active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden /> {label}
          </button>
        );
      })}
    </div>
  );
}
