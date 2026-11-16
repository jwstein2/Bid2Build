/**
 * Customer app Light/Dark theme.
 *
 * - The theme lives on <html data-theme="dark"> (no attribute = light, the default for everyone).
 * - The dark tokens in globals.css only apply while a customer app screen is mounted
 *   (`html[data-theme="dark"]:has(.app-theme)`), so marketing pages, proposal/signing documents,
 *   PDFs and the owner admin keep their current look whatever the preference is.
 * - Guests: localStorage only. Signed-in accounts: also auth user_metadata.b2b_theme, so the
 *   choice follows them across devices. Each copy carries the time it was chosen; the newest wins.
 */
export type ThemeMode = "light" | "dark";
export type ThemePref = { mode: ThemeMode; at: number };

export const THEME_STORAGE_KEY = "b2b-theme";
export const THEME_META_KEY = "b2b_theme";
/** Fired on window when the theme changes, so every toggle on the page stays in step. */
export const THEME_EVENT = "b2b-theme-change";

export function parseThemePref(v: unknown): ThemePref | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { mode?: unknown; at?: unknown };
  if (o.mode !== "light" && o.mode !== "dark") return null;
  const at = typeof o.at === "number" && Number.isFinite(o.at) && o.at >= 0 ? o.at : 0;
  return { mode: o.mode, at };
}

/** The preference to use: the newer of this device's copy and the account's copy. Light by default. */
export function resolveThemePref(local: ThemePref | null, account: ThemePref | null): ThemePref {
  if (local && account) return account.at > local.at ? account : local;
  return local ?? account ?? { mode: "light", at: 0 };
}

/**
 * Runs in <head> before the body paints: applies this device's saved theme so dark users never see
 * a bright frame. Tiny and dependency-free on purpose; any error leaves the default light theme.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||"null");if(p&&p.mode==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}})();`;

/**
 * Rendered by signed-in customer screens right where the app shell starts: if the account's saved
 * choice is newer than this device's (chosen on another device), adopt it before the screen paints.
 */
export function accountThemeScript(account: ThemePref | null): string {
  const json = JSON.stringify(account ?? null).replace(/</g, "\\u003c");
  return `(function(a){try{if(!a)return;var k=${JSON.stringify(THEME_STORAGE_KEY)},l=null;try{l=JSON.parse(localStorage.getItem(k)||"null")}catch(e){}if(l&&(l.at||0)>=(a.at||0))return;try{localStorage.setItem(k,JSON.stringify(a))}catch(e){}var d=document.documentElement;if(a.mode==="dark")d.setAttribute("data-theme","dark");else d.removeAttribute("data-theme")}catch(e){}})(${json});`;
}
