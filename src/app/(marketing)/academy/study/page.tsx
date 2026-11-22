import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, Notice } from "@/components/ui/misc";
import { Disclaimer } from "@/components/academy/kb/parts";
import { StudyApp } from "@/components/academy/kb/study-app";
import { kbAccess, resolveLocation } from "@/lib/academy/kb/server";
import { loadExams, loadLearner, loadStudyItems, studyCategories, studyDecks } from "@/lib/academy/kb/study-server";
import { locationQuery, stateName } from "@/lib/academy/kb/location";
import type { StudyMode } from "@/lib/academy/kb/study";

export const metadata: Metadata = {
  title: "Study: Flashcards, Quizzes and Practice Exams",
  description: "Free contractor flashcards, quizzes and practice exams on OSHA construction safety, lead-safe renovation, codes and running a contracting business. Every rule-based question cites its official source.",
};

const MODES: StudyMode[] = ["flashcards", "quiz", "exam"];

export default async function StudyPage({ searchParams }: PageProps<"/academy/study">) {
  const sp = await searchParams;
  const access = await kbAccess();
  if (!access.enabled && !access.staff) notFound();
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const modeParam = one("mode");
  const initialMode: StudyMode = MODES.find((m) => m === modeParam) ?? "flashcards";
  const loc = await resolveLocation(sp);
  const [items, exams, learner] = await Promise.all([loadStudyItems(), loadExams(), loadLearner()]);

  return (
    <Container className="py-8">
      {access.migrated && !access.enabled && <Notice tone="neutral" title="Staff preview">Only Academy staff can see this page until the code library is turned on in Manage → Codes.</Notice>}
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Study</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">Flashcards, quizzes and practice exams written by Built2Bid. Questions about a rule cite the official section, so you can check it yourself. Free, no sign-in needed.</p>
        </div>
        <p className="text-sm text-ink-soft">
          {loc.state ? <>Showing rules for <span className="font-semibold text-ink">{stateName(loc.state)}</span> plus federal rules.</> : "Showing federal rules."}{" "}
          <Link href={`/academy/codes${locationQuery(loc)}#project-location`} className="font-semibold text-brand hover:underline">Change location</Link>
        </p>
      </div>

      {items.length === 0 ? (
        <Notice className="mt-6" tone="neutral" title="Study materials are on the way">Flashcards and quizzes will appear here shortly. In the meantime, try the <Link href="/academy/codes" className="text-brand hover:underline">code library</Link>.</Notice>
      ) : (
        <StudyApp items={items} decks={studyDecks} categories={studyCategories} exams={exams} learner={learner} state={loc.state} stateLabel={stateName(loc.state)}
          trade={loc.trade} codesQuery={locationQuery(loc)} initialMode={initialMode} initialExam={one("exam") || null} />
      )}

      <p className="mt-8 text-xs text-muted">Questions are original study material. They are not taken from any licensing exam, and Built2Bid is not an accredited testing provider.</p>
      <Disclaimer className="mt-3" />
    </Container>
  );
}
