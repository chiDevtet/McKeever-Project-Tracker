/**
 * Theme preference shared by the server (root layout) and the client toggle.
 * Soft dark is the default; an explicit choice is stored in a cookie (so the
 * server renders the right theme before first paint) and mirrored in
 * localStorage (restored by the boot script if the cookie was cleared).
 */
export type Theme = "light" | "dark";

export const DEFAULT_THEME: Theme = "dark";
export const THEME_COOKIE = "fieldops_theme";
export const THEME_STORAGE_KEY = "fieldops-theme";
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTheme(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" ? value : DEFAULT_THEME;
}

/**
 * Runs in <head> before the body is parsed: applies a saved localStorage
 * preference when it differs from the server-rendered class (for example a
 * cleared cookie) and restores the cookie. No preference keeps soft dark.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=null;try{s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(_){}var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)/),c=m?m[1]:null,t=s==="light"||s==="dark"?s:c||${JSON.stringify(DEFAULT_THEME)};d.classList.toggle("dark",t==="dark");d.style.colorScheme=t;if(s&&c!==t)document.cookie=${JSON.stringify(THEME_COOKIE + "=")}+t+"; path=/; max-age=${THEME_MAX_AGE}; samesite=lax"}catch(_){}})();`;
