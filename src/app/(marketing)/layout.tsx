import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* data-marketing-chrome: hidden on the sign-in screen inside the installed app (globals.css). */}
      <div data-marketing-chrome="" className="contents"><Header /></div>
      <main id="main" className="flex-1">{children}</main>
      <div data-marketing-chrome="" className="contents"><Footer /></div>
    </>
  );
}
