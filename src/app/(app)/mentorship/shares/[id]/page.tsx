import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { Flash } from "@/components/creator/flash";
import { ShareView, type ShareViewData } from "@/components/creator/share-view";
import { addComment } from "../../../learning/actions";
import { resolveComment } from "../../actions";

export const metadata: Metadata = { title: "Shared bid", robots: { index: false } };

export default async function ParticipantSharePage({ params, searchParams }: PageProps<"/mentorship/shares/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getUser();
  if (!user) redirect(`/login?next=/mentorship/shares/${id}`);
  const { data, error } = await (await createClient()).rpc("mentorship_share_view", { p_share_id: id });
  if (error || !data) notFound();
  const view = data as ShareViewData;
  if (view.viewer !== "participant") redirect(`/learning/shares/${id}`);
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/mentorship" className="text-sm underline">← Mentorship</Link>
      <p className="mt-2 text-sm text-ink-soft">This is exactly what your mentor sees.</p>
      <div className="mt-3"><Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} /></div>
      <div className="mt-3"><ShareView data={view} commentAction={addComment} resolveAction={resolveComment} returnTo={`/mentorship/shares/${id}`} /></div>
    </div>
  );
}
