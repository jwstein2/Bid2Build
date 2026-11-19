import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { DraftReview } from "@/components/library/generator/draft-review";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review your price library draft", robots: { index: false } };

export default async function DraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect(`/login?next=/dashboard/items/generate/${encodeURIComponent(id)}`);
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-guide-page="library.generate-review">
      <Link href="/dashboard/items/generate" className="inline-flex items-center gap-1 text-sm font-semibold text-brand"><ChevronLeft className="h-4 w-4" aria-hidden /> Your drafts</Link>
      <DraftReview id={id} reused={sp.reused === "1"} />
    </div>
  );
}
