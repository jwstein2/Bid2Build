import { accountThemeScript, type ThemePref } from "@/lib/theme";

/**
 * Server-rendered at the top of signed-in customer screens. Adopts the account's saved theme when
 * it is newer than this device's copy (chosen on another device), before the screen paints.
 */
export function AccountThemeScript({ pref }: { pref: ThemePref | null | undefined }) {
  if (!pref) return null;
  return <script dangerouslySetInnerHTML={{ __html: accountThemeScript(pref) }} />;
}
