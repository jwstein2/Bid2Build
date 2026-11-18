import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Category = { slug: string; name: string; description: string | null; icon: string | null; sort_order: number; access: "members" | "premium"; staff_only_posting: boolean };
export type FeedRow = {
  id: string; category_slug: string; category_name: string; trade_slug: string | null; state_code: string | null; kind: string; title: string; excerpt: string;
  link_url: string | null; image_path: string | null; pinned: boolean; locked: boolean; answered: boolean; comment_count: number; reaction_count: number;
  last_activity_at: string; created_at: string; author_id: string; author_name: string; author_level: number; author_role: string; reacted: boolean; saved: boolean; total: number;
};
export type PostComment = {
  id: string; parent_id: string | null; body: string | null; status: string; helpful: boolean; reaction_count: number; created_at: string; edited_at: string | null;
  author_id: string; author_name: string; author_role: string; mine: boolean; reacted: boolean;
};
export type PostDetail = {
  id: string; category_slug: string; category_name: string; trade_slug: string | null; state_code: string | null; kind: string; title: string; body: string; link_url: string | null;
  image_path: string | null; pinned: boolean; locked: boolean; status: string; answered_comment_id: string | null; comment_count: number; reaction_count: number;
  created_at: string; edited_at: string | null; author_id: string; author_name: string; author_role: string; author_level: number; reacted: boolean; saved: boolean; mine: boolean;
  comments: PostComment[];
};

/** Shown to visitors before they join (the categories table itself is member-only). Mirrors the migration seed. */
export const PUBLIC_CATEGORIES = [
  ["General Contractor Discussion", "Running a contracting business, across every trade."],
  ["Sales & Closing", "Leads, appointments, presenting estimates, follow-up and closing."],
  ["Estimating & Pricing", "Takeoffs, unit pricing, markup, margin and change orders."],
  ["Project Management", "Scheduling, crews, subs, materials and customer updates."],
  ["Accounting & Finance", "Job costing, cash flow, invoicing and working with your accountant."],
  ["HR & Hiring", "Finding, training, paying and keeping good people."],
  ["Recurring Revenue", "Maintenance plans, service agreements, repeat and referral work."],
  ["Marketing & Lead Generation", "Reviews, local search, referrals, ads and your website."],
  ["Operations", "Systems, equipment, vehicles, suppliers and day-to-day running."],
  ["Trade-Specific Advice", "Technical and business questions for your trade."],
  ["Software Questions", "Getting the most out of Built2Bid and other tools."],
  ["Industry News", "Material prices, codes, regulations and market changes."],
] as const;

export const PAGE_SIZE = 20;

export async function loadCategories(): Promise<Category[]> {
  const db = await createClient();
  const { data } = await db.from("academy_categories").select("slug, name, description, icon, sort_order, access, staff_only_posting").order("sort_order");
  return (data ?? []) as Category[];
}

export async function loadFeed(opts: { category?: string; trade?: string; q?: string; sort?: string; kind?: string; saved?: boolean; author?: string; page?: number }) {
  const db = await createClient();
  const page = Math.max(1, Math.min(opts.page ?? 1, 250));
  const sort = ["activity", "new", "top", "relevance"].includes(opts.sort ?? "") ? opts.sort : opts.q ? "relevance" : "activity";
  const { data, error } = await db.rpc("academy_feed", {
    p_category: opts.category || null, p_trade: opts.trade || null, p_q: opts.q?.slice(0, 200) || null, p_sort: sort, p_kind: opts.kind || null,
    p_saved: Boolean(opts.saved), p_author: opts.author || null, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE,
  });
  const rows = (error ? [] : (data ?? [])) as FeedRow[];
  return { rows, total: rows[0] ? Number(rows[0].total) : 0, page, sort: sort!, error: error?.message ?? null };
}

export async function loadPost(id: string): Promise<PostDetail | null> {
  const db = await createClient();
  const { data, error } = await db.rpc("academy_post", { p_id: id });
  return error ? null : (data as PostDetail);
}
