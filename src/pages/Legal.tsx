import { Link } from "react-router-dom";
import { SubpageShell } from "../components/SubpageShell";
import { Reveal } from "../components/primitives";
import { usePageSeo } from "../lib/hooks";
import { CONTACT_EMAIL } from "../lib/site";

function LegalSection({
  title,
  paragraphs,
  list,
}: {
  title: string;
  paragraphs?: string[];
  list?: string[];
}) {
  return (
    <section className="mt-9">
      <h2 className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h2>
      {paragraphs?.map((p, i) => (
        <p key={i} className="mt-3 text-[14px] leading-7 text-ink-mute">
          {p}
        </p>
      ))}
      {list ? (
        <ul className="mt-3 space-y-2.5">
          {list.map((item) => (
            <li
              key={item}
              className="flex gap-2.5 text-[14px] leading-6.5 text-ink-mute"
            >
              <span
                className="mt-[10px] size-1 shrink-0 rounded-full bg-brand-500"
                aria-hidden="true"
              />
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function PrivacyPage() {
  usePageSeo({
    title: "Privacy Policy — Zybble",
    description:
      "How Zybble collects, uses, stores, and deletes account and usage data — and the control you keep over your searches, lead lists, and exports.",
    path: "/privacy",
  });

  return (
    <SubpageShell
      eyebrow="Legal"
      title="Privacy Policy."
      intro="How Zybble collects, uses, and deletes data — in language you'll actually read."
    >
      <Reveal className="mx-auto max-w-[720px] pb-4">
        <p className="mt-8 text-[11.5px] font-medium tracking-[0.08em] text-neutral-400 uppercase">
          Last updated January 1, 2026
        </p>
        <LegalSection
          title="1. What we collect"
          paragraphs={[
            "We keep collection narrow and tied to running the product:",
          ]}
          list={[
            "Account details — your name, email address, and password (stored only as a secure hash).",
            "Plan and billing metadata — your plan and renewal status. Payment details are processed by our payment provider and never stored on our servers.",
            "Usage data — the searches you run, the lead lists you create, and the exports you generate, so the product works as expected.",
            "Support conversations — anything you email or message to us, so we can answer in context.",
          ]}
        />
        <LegalSection
          title="2. How we use it"
          list={[
            "Search business data and structure the results into your lead lists.",
            "Enrich leads with contact details and fields where they're available.",
            "Analyze businesses with Zybble AI and generate summaries.",
            "Run secure exports and deliver your CSV files.",
            "Contact you about plan changes, limits, and features you use.",
          ]}
        />
        <LegalSection
          title="3. What we never do"
          list={[
            "We do not sell your personal information to anyone.",
            "We do not share your lead lists or exports with other customers.",
            "We do not use AI output to make claims beyond the underlying business data — treat every AI summary as a starting point to verify.",
          ]}
        />
        <LegalSection
          title="4. Business data in searches"
          paragraphs={[
            "Leads are assembled from publicly available business information — listings, websites, and public profiles. Where a detail isn't publicly available (an email address, for example), the field simply stays empty.",
          ]}
        />
        <LegalSection
          title="5. How long we keep it"
          paragraphs={[
            "Your data lives only while your account does. Deleting your account deletes your searches, lead lists, and exports. Backups are purged on a rolling schedule.",
          ]}
        />
        <LegalSection
          title="6. Your control"
          list={[
            "Export your leads to CSV anytime — on every plan.",
            "Correct account details from your workspace settings.",
            "Delete individual searches, lists, or the entire account.",
            "Ask us about anything you can't see in the product.",
          ]}
        />
        <p className="mt-10 rounded-2xl border border-black/[0.06] bg-white px-5 py-4 text-[13px] leading-6 text-ink-mute">
          Questions or requests?{" "}
          <Link
            to="#/contact"
            className="font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            Contact us
          </Link>{" "}
          or email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Reveal>
    </SubpageShell>
  );
}

export function TermsPage() {
  usePageSeo({
    title: "Terms of Service — Zybble",
    description:
      "The contract for Zybble: your account, what the product provides, fair use of monthly limits, acceptable use, data ownership, and cancellation.",
    path: "/terms",
  });

  return (
    <SubpageShell
      eyebrow="Legal"
      title="Terms of Service."
      intro="The contract between you and Zybble — plain, direct, and short enough to finish."
    >
      <Reveal className="mx-auto max-w-[720px] pb-4">
        <p className="mt-8 text-[11.5px] font-medium tracking-[0.08em] text-neutral-400 uppercase">
          Last updated January 1, 2026
        </p>
        <LegalSection
          title="1. The short version"
          paragraphs={[
            "Zybble helps you discover businesses and turn them into organized lead lists. Create an account, use the service fairly, and respect the data you export — and everything else below is just detail.",
          ]}
        />
        <LegalSection
          title="2. Your account"
          paragraphs={[
            "You must be at least 18 years old. Keep your credentials private — you're responsible for activity under your account.",
          ]}
        />
        <LegalSection
          title="3. What Zybble provides"
          list={[
            "Natural-language business searches and structured lead lists.",
            "Contact and business fields where available.",
            "Zybble AI summaries on Growth plans and above.",
            "CSV exports on every plan.",
            "Client workspaces on Agency and Scale plans.",
          ]}
        />
        <LegalSection
          title="4. Fair use"
          list={[
            "Monthly lead allowances reset at the start of each monthly cycle and do not roll over.",
            "Don't abuse rate limits or build automated scrapes of Zybble's results.",
            "Don't share one login across multiple people — plans include the users and team members shown on the pricing page.",
          ]}
        />
        <LegalSection
          title="5. Acceptable use"
          paragraphs={[
            "You may not use Zybble for unlawful outreach, spam or scams, stalking or harassment, or to resell raw lead data to third parties. Business data is informational — verify details before you act on them.",
          ]}
        />
        <LegalSection
          title="6. Data and your exports"
          paragraphs={[
            "Leads are built from publicly available business information. You own your saved lead lists and CSV exports; use them in line with applicable law. AI summaries are generated interpretations of available data, not verified facts.",
          ]}
        />
        <LegalSection
          title="7. Pricing and cancellation"
          list={[
            "Plans are billed monthly in advance.",
            "No annual commitments, no long-term discount requirements.",
            "Cancel anytime — the change takes effect at the end of the current billing period.",
            "Lead allowances reset monthly.",
          ]}
        />
        <LegalSection
          title="8. Liability"
          paragraphs={[
            "Zybble is a prospecting tool, not professional advice. We aren't liable for the outcomes of your outreach or business decisions.",
          ]}
        />
        <LegalSection
          title="9. Changes to these terms"
          paragraphs={[
            "If we update these terms, we'll post the new version here and update the date above. Continuing to use Zybble after a change means you accept the updated terms.",
          ]}
        />
        <p className="mt-10 rounded-2xl border border-black/[0.06] bg-white px-5 py-4 text-[13px] leading-6 text-ink-mute">
          Questions about these terms?{" "}
          <Link
            to="#/contact"
            className="font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            Talk to us
          </Link>{" "}
          or email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Reveal>
    </SubpageShell>
  );
}
