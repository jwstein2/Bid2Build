import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, ExternalLink, Lock, Pin } from "lucide-react";
import { Container, Notice } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { Flash } from "@/components/creator/flash";
import { Avatar } from "@/components/academy/avatar";
import { ReactButton, ReportButton, SaveButton, Submit } from "@/components/academy/controls";
import { ROLE_LABEL, timeAgo } from "@/components/academy/format";
import { listTrades, loadMe, signedMediaUrls } from "@/lib/academy/server";
import { loadPost, type PostComment } from "@/lib/academy/community";
import { addComment, deleteComment, deletePost, editPost, markHelpful, moderate } from "../../actions";

// Discussions are private to members: never indexed.
export const metadata: Metadata = { title: "Discussion", robots: { index: false, follow: false } };

const input = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";

export default async function PostPage({ params, searchParams }: PageProps<"/academy/post/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 300) : undefined);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { me, user } = await loadMe();
  if (!user) redirect(`/login?next=/academy/post/${id}`);
  if (!me.member) redirect("/academy/join");
  const post = await loadPost(id);
  if (!post) notFound();
  const [trades, media] = await Promise.all([listTrades(), signedMediaUrls([post.image_path])]);
  const tradeName = new Map(trades.map((t) => [t.slug, t.name]));
  const staff = ["admin", "moderator"].includes(me.role ?? "");
  const canWrite = me.status !== "suspended";
  const top = post.comments.filter((c) => !c.parent_id);
  const replies = (pid: string) => post.comments.filter((c) => c.parent_id === pid);
  const canMarkHelpful = post.kind === "question" && (post.mine || staff);
  const ret = `/academy/post/${post.id}`;

  const Comment = ({ c, nested }: { c: PostComment; nested?: boolean }) => (
    <li id={`c-${c.id}`} className={`scroll-mt-24 ${nested ? "ml-6 border-l-2 border-line pl-4 sm:ml-12" : ""}`}>
      <div className={`rounded-lg p-3 ${c.helpful ? "bg-ok-tint ring-1 ring-ok/30" : ""}`}>
        <div className="flex items-start gap-2.5">
          <Avatar id={c.author_id} name={c.author_name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
              <Link href={`/academy/members/${c.author_id}`} className="font-semibold text-ink hover:underline">{c.author_name}</Link>
              {c.author_role !== "member" && <span className="rounded bg-brand-tint px-1.5 font-semibold text-navy">{ROLE_LABEL[c.author_role]}</span>}
              <span>· {timeAgo(c.created_at)}{c.edited_at ? " · edited" : ""}</span>
              {c.helpful && <span className="inline-flex items-center gap-1 font-semibold text-ok"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Helpful answer</span>}
            </p>
            {c.status === "visible" ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p> : <p className="mt-1 text-sm italic text-muted">This comment was removed.</p>}
            {c.status === "visible" && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <ReactButton type="comment" id={c.id} count={c.reaction_count} reacted={c.reacted} disabled={c.mine} />
                {canWrite && !post.locked && (
                  <details className="group">
                    <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-md px-2 text-sm font-semibold text-muted hover:bg-black/5 hover:text-ink [&::-webkit-details-marker]:hidden">Reply</summary>
                    <form action={addComment} className="mt-2 grid gap-2">
                      <input type="hidden" name="post_id" value={post.id} /><input type="hidden" name="parent_id" value={c.id} />
                      <label className="sr-only" htmlFor={`r-${c.id}`}>Reply</label>
                      <textarea id={`r-${c.id}`} name="body" required maxLength={5000} rows={2} className={input} />
                      <div><Submit size="sm" pending="Replying…">Reply</Submit></div>
                    </form>
                  </details>
                )}
                {canMarkHelpful && !c.mine && (
                  <form action={markHelpful}>
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="post_id" value={post.id} /><input type="hidden" name="on" value={c.helpful ? "false" : "true"} />
                    <button className="inline-flex min-h-9 items-center rounded-md px-2 text-sm font-semibold text-ok hover:bg-ok-tint">{c.helpful ? "Unmark helpful" : "Mark as helpful answer"}</button>
                  </form>
                )}
                {c.mine && (
                  <form action={deleteComment}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="post_id" value={post.id} />
                    <button className="inline-flex min-h-9 items-center rounded-md px-2 text-sm font-semibold text-muted hover:text-danger">Delete</button></form>
                )}
                {!c.mine && <ReportButton type="comment" id={c.id} />}
                {staff && (
                  <form action={moderate}><input type="hidden" name="type" value="comment" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="action" value="remove" /><input type="hidden" name="return_to" value={ret} />
                    <button className="inline-flex min-h-9 items-center rounded-md px-2 text-sm font-semibold text-danger hover:bg-danger-tint">Remove</button></form>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {!nested && replies(c.id).length > 0 && <ul className="mt-1 grid gap-1">{replies(c.id).map((r) => <Comment key={r.id} c={r} nested />)}</ul>}
    </li>
  );

  return (
    <Container className="max-w-3xl py-6">
      <Link href="/academy" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Community</Link>
      <div className="mt-3"><Flash msg={s("msg")} err={s("err")} /></div>
      {post.status !== "visible" && <Notice tone="warn" className="mt-3" title={`This post is ${post.status}`}>Only you{staff ? " and moderators" : ""} can see it.</Notice>}
      <article className="mt-3 rounded-xl border border-line bg-surface p-5 shadow-card" data-testid="post">
        <div className="flex items-start gap-3">
          <Avatar id={post.author_id} name={post.author_name} level={post.author_level} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
              <Link href={`/academy/members/${post.author_id}`} className="font-semibold text-ink hover:underline">{post.author_name}</Link>
              {post.author_role !== "member" && <span className="rounded bg-brand-tint px-1.5 font-semibold text-navy">{ROLE_LABEL[post.author_role]}</span>}
              <span>· {timeAgo(post.created_at)}{post.edited_at ? " · edited" : ""} · <Link className="hover:underline" href={`/academy?category=${post.category_slug}`}>{post.category_name}</Link></span>
              {post.trade_slug && <Link href={`/academy?trade=${post.trade_slug}`} className="rounded bg-accent-tint px-1.5 font-semibold text-accent-dark">{tradeName.get(post.trade_slug) ?? post.trade_slug}</Link>}
              {post.state_code && <span>· {post.state_code}</span>}
            </p>
            <h1 className="mt-1 flex flex-wrap items-center gap-1.5 font-display text-xl font-extrabold break-words">
              {post.pinned && <Pin className="h-4 w-4 text-accent-ink" aria-label="Pinned" />}{post.locked && <Lock className="h-4 w-4 text-muted" aria-label="Locked" />}
              {post.kind === "question" && <span className={`rounded px-1.5 text-xs font-semibold ${post.answered_comment_id ? "bg-ok-tint text-ok" : "bg-warn-tint text-warn"}`}>{post.answered_comment_id ? "Answered" : "Question"}</span>}
              {post.title}
            </h1>
          </div>
        </div>
        <div className="mt-4 whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed">{post.body}</div>
        {post.image_path && media.get(post.image_path) && (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
          <img src={media.get(post.image_path)} alt="Image attached to the post" className="mt-4 max-h-[32rem] w-auto rounded-lg border border-line" loading="lazy" />
        )}
        {post.link_url && (
          <a href={post.link_url} target="_blank" rel="noopener noreferrer nofollow ugc" className="mt-4 inline-flex max-w-full items-center gap-1.5 truncate rounded-lg border border-line px-3 py-2 text-sm font-semibold text-accent-ink hover:bg-paper">
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden /> <span className="truncate">{post.link_url}</span>
          </a>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-line pt-3">
          <ReactButton type="post" id={post.id} count={post.reaction_count} reacted={post.reacted} disabled={post.mine} />
          <SaveButton type="post" id={post.id} saved={post.saved} />
          {!post.mine && <ReportButton type="post" id={post.id} />}
          {post.mine && post.status === "visible" && !post.locked && (
            <details className="w-full">
              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-md px-2 text-sm font-semibold text-muted hover:bg-black/5 hover:text-ink [&::-webkit-details-marker]:hidden">Edit or delete</summary>
              <form action={editPost} className="mt-2 grid gap-2">
                <input type="hidden" name="id" value={post.id} />
                <label className="text-sm font-semibold">Title<input name="title" defaultValue={post.title} required minLength={3} maxLength={160} className={`${input} mt-1`} /></label>
                <label className="text-sm font-semibold">Details<textarea name="body" defaultValue={post.body} required maxLength={10000} rows={6} className={`${input} mt-1`} /></label>
                <label className="text-sm font-semibold">Link<input name="link_url" type="url" defaultValue={post.link_url ?? ""} className={`${input} mt-1`} /></label>
                <div className="flex gap-2"><Submit size="sm">Save changes</Submit></div>
              </form>
              <form action={deletePost} className="mt-2"><input type="hidden" name="id" value={post.id} /><button className={buttonClass("danger", "sm")}>Delete post</button></form>
            </details>
          )}
        </div>
        {staff && (
          <div className="mt-3 flex flex-wrap gap-1.5 rounded-lg bg-paper p-2 text-xs" aria-label="Moderation">
            <span className="self-center px-1 font-semibold text-muted">Moderate:</span>
            {[post.pinned ? "unpin" : "pin", post.locked ? "unlock" : "lock", post.status === "visible" ? "hide" : "restore", "remove"].map((a) => (
              <form key={a} action={moderate}>
                <input type="hidden" name="type" value="post" /><input type="hidden" name="id" value={post.id} /><input type="hidden" name="action" value={a} /><input type="hidden" name="return_to" value={a === "remove" ? "/academy" : ret} />
                <button className={buttonClass(a === "remove" ? "danger" : "secondary", "sm", "capitalize")}>{a}</button>
              </form>
            ))}
          </div>
        )}
      </article>

      <section id="comments" className="mt-5 scroll-mt-24 rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-lg font-bold">{post.comment_count} {post.comment_count === 1 ? "comment" : "comments"}</h2>
        {canWrite && (!post.locked || staff) ? (
          <form action={addComment} className="mt-3 grid gap-2">
            <input type="hidden" name="post_id" value={post.id} />
            <label htmlFor="new-comment" className="sr-only">Add a comment</label>
            <textarea id="new-comment" name="body" required maxLength={5000} rows={3} placeholder={post.kind === "question" ? "Share your answer or experience" : "Add a comment"} className={input} />
            <div><Submit pending="Posting…">Comment</Submit></div>
          </form>
        ) : (
          <p className="mt-2 text-sm text-muted">{post.locked ? "This discussion is locked." : "Commenting is paused on your account."}</p>
        )}
        <ul className="mt-4 grid gap-2">{top.map((c) => <Comment key={c.id} c={c} />)}</ul>
      </section>
    </Container>
  );
}
