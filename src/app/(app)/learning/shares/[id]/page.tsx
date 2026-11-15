import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { Flash } from "@/components/creator/flash";
import { ShareView, type ShareViewData } from "@/components/creator/share-view";
import { addComment } from "../../actions";

export const metadata: Metadata = { title: "Shared bid", robots: { index: false } };

export default async function CreatorSharePage({ params, searchParams }: PageProps<"/learning/shares/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getUser();
  if (!user) redirect(`/login?next=/learning/shares/${id}`);
  const { data, error } = await (await createClient()).rpc("mentorship_share_view", { p_share_id: id });
  if (error || !data) notFound();
  const view = data as ShareViewData;
  if (view.viewer !== "creator") redirect(`/mentorship/shares/${id}`);
  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/learning?program=${view.program_id}&tab=shares`} className="text-sm underline">← Shared bids</Link>
      <div className="mt-3"><Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} /></div>
      <div className="mt-3"><ShareView data={view} commentAction={addComment} returnTo={`/learning/shares/${id}`} /></div>
    </div>
  );
}
