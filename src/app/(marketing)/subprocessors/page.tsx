import type { Metadata } from "next";
import { LegalPage, H2, A } from "@/components/legal/legal-page";
import { SUBPROCESSORS, SUBPROCESSORS_UPDATED } from "@/lib/legal/subprocessors";

export const metadata: Metadata = {
  title: "Service Providers (Subprocessors)",
  description: "The companies that process data on Built2Bid's behalf, what they do and what data they receive.",
  alternates: { canonical: "/subprocessors" },
};

export default function SubprocessorsPage() {
  return (
    <LegalPage title="Service Providers (Subprocessors)" updated={SUBPROCESSORS_UPDATED} docKey="subprocessors">
      <p>These companies process data on our behalf to run Built2Bid, under contracts that limit how they can use it. We don&apos;t sell personal information. See our <A href="/privacy">Privacy Policy</A> and <A href="/security">Security</A> page for more.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead><tr className="border-b border-line text-left text-ink"><th className="py-2 pr-3">Provider</th><th className="py-2 pr-3">What it does for us</th><th className="py-2 pr-3">Data it receives</th><th className="py-2">Location</th></tr></thead>
          <tbody>
            {SUBPROCESSORS.map((s) => (
              <tr key={s.name} className="border-b border-line align-top" data-testid="subprocessor-row">
                <td className="py-2 pr-3 font-semibold text-ink">{s.name}</td>
                <td className="py-2 pr-3">{s.purpose}{s.when && <span className="mt-1 block text-xs">{s.when}</span>}</td>
                <td className="py-2 pr-3">{s.data}</td>
                <td className="py-2">{s.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <H2>Changes</H2>
      <p>We update this page before a new provider starts processing personal data. Business customers who need advance notice of changes can ask at <A href="mailto:privacy@built2bid.org">privacy@built2bid.org</A>.</p>
    </LegalPage>
  );
}
