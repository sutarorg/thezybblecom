import {
  Database,
  FileDown,
  FileSearch,
  FolderKanban,
  Lightbulb,
  ListChecks,
  Phone,
  Sparkles,
  Users,
} from "lucide-react";
import { Reveal, SectionHeading } from "../components/primitives";

const CAPABILITIES = [
  {
    icon: Sparkles,
    title: "AI lead discovery",
    copy: "Describe the businesses out loud — Zybble structures the search.",
  },
  {
    icon: Database,
    title: "Business data",
    copy: "Names, categories, addresses, ratings and hours, normalized into rows.",
  },
  {
    icon: Phone,
    title: "Phone & email data",
    copy: "Direct contact details on every lead, emails when publicly listed.",
  },
  {
    icon: ListChecks,
    title: "Lead lists",
    copy: "Save searches into tagged lists — unlimited on paid plans.",
  },
  {
    icon: FileDown,
    title: "CSV export",
    copy: "Pick your fields and take leads anywhere. On every plan.",
  },
  {
    icon: FileSearch,
    title: "Lead enrichment",
    copy: "Fill in the gaps — websites, contacts and details per business.",
  },
  {
    icon: Lightbulb,
    title: "AI insights",
    copy: "Summaries and outreach angles from available business data.",
  },
  {
    icon: Users,
    title: "Team workspaces",
    copy: "Bring 3–5 teammates into one shared account.",
  },
  {
    icon: FolderKanban,
    title: "Client workspaces",
    copy: "Separate searches, lists and exports per client.",
  },
];

export function Capabilities() {
  return (
    <section
      aria-labelledby="capabilities-title"
      className="mt-28 sm:mt-36 md:mt-44"
    >
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <SectionHeading
          eyebrow="What you get"
          title={
            <span id="capabilities-title">What you actually get.</span>
          }
          copy="No invented logos, no borrowed praise. Just the product's capabilities, stated plainly."
        />

        <ul className="mt-12 grid gap-3 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((cap, i) => (
            <Reveal as="li" key={cap.title} delay={i * 50} className="h-full">
              <div className="h-full rounded-2xl border border-black/[0.06] bg-white p-5 transition-colors duration-300 hover:border-black/[0.1]">
                <span className="grid size-8.5 place-items-center rounded-lg bg-brand-50 text-brand-700">
                  <cap.icon className="size-4" aria-hidden="true" />
                </span>
                <h3 className="mt-3.5 text-[13.5px] leading-5 font-semibold text-ink">
                  {cap.title}
                </h3>
                <p className="mt-1 text-[12.5px] leading-5.5 text-ink-mute">
                  {cap.copy}
                </p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
