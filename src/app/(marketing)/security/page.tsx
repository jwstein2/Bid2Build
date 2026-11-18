import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/misc";

export const metadata: Metadata = {
  title: "Security",
  description: "How Built2Bid protects your account, bids, customers and financial data.",
  alternates: { canonical: "/security" },
};

const SECURITY_EMAIL = "privacy@built2bid.org";
const LAST_UPDATED = "November 18, 2026";

export default function Security() {
  return (
    <Container className="py-12">
      <div className="mx-auto max-w-2xl space-y-4 leading-relaxed text-ink-soft">
        <h1 className="text-4xl font-extrabold text-ink">Security</h1>
        <p className="text-sm">Last updated {LAST_UPDATED}</p>
        <p>
          Built2Bid L.L.C. keeps a written Information Security Policy, owned by our founder and reviewed at least once a year and
          after any major change or incident. This page summarizes how we protect your account, your bids and customers, and any
          financial data you connect.
        </p>

        <h2 className="pt-2 text-xl font-bold text-ink">Your data is kept separate</h2>
        <p>
          Every record is tied to your account or company workspace, and the database enforces row-level security, so one
          customer&apos;s data can&apos;t be read by another. Logos, photos and generated documents are stored privately and shared only
          through short-lived signed links.
        </p>

        <h2 className="pt-2 text-xl font-bold text-ink">Sign-in and access</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Passwordless sign-in with one-time codes sent to your email, so there is no Built2Bid password to steal or reuse.</li>
          <li>Optional two-step sign-in with an authenticator app. It is required before anyone can connect a bank account.</li>
          <li>Team members get only the workspaces and features their role allows, and you can remove access at any time.</li>
          <li>Our own administrative access is limited to the founder, protected by multi-factor authentication, and recorded in an audit log.</li>
        </ul>

        <h2 className="pt-2 text-xl font-bold text-ink">Encryption</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>All traffic uses HTTPS (TLS 1.2 or newer) with HSTS.</li>
          <li>Data is encrypted at rest by our database and storage provider.</li>
          <li>Bank connection tokens get an extra layer of AES-256-GCM encryption before they are stored, and are never sent to your browser.</li>
          <li>Keys and secrets live only in our hosting provider&apos;s encrypted environment settings, never in source code.</li>
        </ul>

        <h2 className="pt-2 text-xl font-bold text-ink">Connected bank accounts</h2>
        <p>
          If you choose to connect a bank account, we use Plaid with read-only access to balances and transactions, for cash-flow
          forecasting and reconciliation. Built2Bid never sees your bank sign-in details and cannot move money. You can disconnect
          an account at any time.
        </p>

        <h2 className="pt-2 text-xl font-bold text-ink">Payments</h2>
        <p>Card payments are handled by Stripe. We never store card numbers, and every Stripe event we receive is signature-verified.</p>

        <h2 className="pt-2 text-xl font-bold text-ink">Building and running the service</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Every code change goes through a reviewed pull request and is tested before it goes live.</li>
          <li>Dependencies are monitored for known vulnerabilities and patched promptly.</li>
          <li>Rate limits, upload file-type checks and outbound request guards protect against common attacks.</li>
          <li>Uptime and error monitoring alert us to problems, and the database is backed up daily.</li>
        </ul>

        <h2 className="pt-2 text-xl font-bold text-ink">Trusted providers</h2>
        <p>
          We rely on established providers that maintain their own security programs, including Supabase (database, sign-in and
          storage), Netlify (hosting), Stripe (payments) and Plaid (bank connections). We review each provider before use.
        </p>

        <h2 className="pt-2 text-xl font-bold text-ink">Your control</h2>
        <p>
          You can export all of your data or delete your account from Account settings. See our{" "}
          <Link className="underline" href="/privacy">Privacy Policy</Link> for what we collect and how long we keep it.
        </p>

        <h2 className="pt-2 text-xl font-bold text-ink">Incidents</h2>
        <p>
          We have a written incident response plan. If a security incident affects your data, we will notify you without undue
          delay and as required by law.
        </p>

        <h2 className="pt-2 text-xl font-bold text-ink">Report a security issue</h2>
        <p>
          If you believe you&apos;ve found a vulnerability, email{" "}
          <a className="underline" href={`mailto:${SECURITY_EMAIL}?subject=Security%20report`}>{SECURITY_EMAIL}</a>. Please give us a
          reasonable chance to fix it before sharing it publicly, and don&apos;t access or change other customers&apos; data. We
          aim to reply within 3 business days.
        </p>
      </div>
    </Container>
  );
}
