import {
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
  TriangleAlert,
} from "lucide-react";
import { cn } from "../utils/cn";
import { SubpageShell } from "../components/SubpageShell";
import { Reveal } from "../components/primitives";
import { usePageSeo } from "../lib/hooks";
import { CONTACT_EMAIL, WEB3FORMS_KEY } from "../lib/site";

const TOPICS = [
  "General question",
  "Product demo",
  "Pricing & plans",
  "Support",
  "Partnership",
];

function Field({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-[12px] font-semibold text-ink-soft"
      >
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-black/[0.08] bg-white px-3.5 py-2.5 text-[13.5px] text-ink placeholder:text-neutral-400 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-colors focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15";

const inputErrorClass =
  "border-red-300 focus:border-red-500 focus:ring-red-500/10";

type Status = "idle" | "sending" | "sent" | "error";

type FormState = {
  name: string;
  email: string;
  topic: string;
  message: string;
};

export default function ContactPage() {
  usePageSeo({
    title: "Contact Zybble — Talk to us about lead discovery",
    description:
      "Questions about Zybble, pricing, or plans? One message reaches a human. Write to us and we'll get back to you within one business day.",
    path: "/contact",
  });

  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    topic: TOPICS[0],
    message: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  // honeypot field — invisible to humans, spoiled by bots
  const [botcheck, setBotcheck] = useState("");

  const update = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = "Please add your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      next.email = "Please add a valid email address.";
    if (form.message.trim().length < 10)
      next.message = "Tell us a little more (10+ characters).";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;
    if (!validate()) return;

    setStatus("sending");
    setStatusMessage("");
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          access_key: WEB3FORMS_KEY,
          subject: `Zybble contact — ${form.topic} · ${form.name.trim()}`,
          from_name: "Zybble Contact Form",
          name: form.name.trim(),
          email: form.email.trim(),
          topic: form.topic,
          message: form.message.trim(),
          botcheck,
        }),
      });
      const data: { success?: boolean; message?: string } = await res
        .json()
        .catch(() => ({}));
      if (res.ok && data.success) {
        setStatus("sent");
        setStatusMessage(
          "Message sent — thanks for writing. We'll reply to your inbox soon."
        );
      } else {
        setStatus("error");
        setStatusMessage(
          data.message ||
            "Something went wrong sending your message. Please try again."
        );
      }
    } catch {
      setStatus("error");
      setStatusMessage(
        "We couldn't reach the form service. Check your connection and try again."
      );
    }
  };

  const resetForm = () => {
    setForm({ name: "", email: "", topic: TOPICS[0], message: "" });
    setErrors({});
    setStatus("idle");
    setStatusMessage("");
  };

  return (
    <SubpageShell
      eyebrow="Contact"
      title="Talk to us."
      intro="Questions about Zybble, pricing, or plans? One email reaches a human — write to us and we'll get back to you within one business day."
    >
      <div className="mx-auto max-w-[720px]">
        <div className="mt-10 grid gap-8 sm:mt-12 lg:grid-cols-12 lg:gap-12">
          {/* direct contact column */}
          <Reveal as="aside" className="lg:col-span-5">
            <h2 className="font-display text-[17px] font-semibold tracking-[-0.02em] text-ink">
              Prefer email?
            </h2>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-3 inline-flex items-center gap-2 text-[13.5px] font-medium text-ink-soft transition-colors hover:text-brand-700"
            >
              <span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-700">
                <Mail className="size-3.5" aria-hidden="true" />
              </span>
              {CONTACT_EMAIL}
            </a>
            <ul className="mt-6 space-y-2.5">
              {[
                "Replies typically within one business day",
                "A person reads every message",
                "No mailing lists — we only reply to you",
              ].map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-2 text-[13px] leading-5.5 text-ink-mute"
                >
                  <Check
                    className="mt-1 size-3.5 shrink-0 text-brand-600"
                    aria-hidden="true"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </Reveal>

          {/* form */}
          <Reveal delay={100} className="lg:col-span-7">
            <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:p-7">
              {status === "sent" ? (
                <div role="status" className="py-4 text-center sm:py-8">
                  <span className="mx-auto grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
                    <CheckCircle2 className="size-5" aria-hidden="true" />
                  </span>
                  <p className="font-display mt-4 text-[19px] font-semibold tracking-[-0.02em] text-ink">
                    Message sent.
                  </p>
                  <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-ink-mute">
                    {statusMessage}
                  </p>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="group mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600"
                  >
                    Send another message
                    <ArrowRight
                      className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              ) : (
                <form onSubmit={onSubmit} noValidate>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="contact-name" label="Name">
                      <input
                        id="contact-name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        placeholder="Jordan Rivera"
                        value={form.name}
                        onChange={update}
                        aria-invalid={Boolean(errors.name)}
                        className={cn(inputClass, errors.name && inputErrorClass)}
                      />
                      {errors.name ? (
                        <p className="mt-1.5 text-[11.5px] text-red-600">
                          {errors.name}
                        </p>
                      ) : null}
                    </Field>
                    <Field id="contact-email" label="Email">
                      <input
                        id="contact-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.com"
                        value={form.email}
                        onChange={update}
                        aria-invalid={Boolean(errors.email)}
                        className={cn(inputClass, errors.email && inputErrorClass)}
                      />
                      {errors.email ? (
                        <p className="mt-1.5 text-[11.5px] text-red-600">
                          {errors.email}
                        </p>
                      ) : null}
                    </Field>
                  </div>

                  <Field id="contact-topic" label="Topic" className="mt-4">
                    <select
                      id="contact-topic"
                      name="topic"
                      value={form.topic}
                      onChange={update}
                      className={cn(inputClass, "appearance-none bg-white")}
                    >
                      {TOPICS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field id="contact-message" label="Message" className="mt-4">
                    <textarea
                      id="contact-message"
                      name="message"
                      rows={5}
                      placeholder="Tell us what you're trying to do — which businesses you need, which market you're working, or what's blocking you."
                      value={form.message}
                      onChange={update}
                      aria-invalid={Boolean(errors.message)}
                      className={cn(
                        inputClass,
                        "resize-y",
                        errors.message && inputErrorClass
                      )}
                    />
                    {errors.message ? (
                      <p className="mt-1.5 text-[11.5px] text-red-600">
                        {errors.message}
                      </p>
                    ) : null}
                  </Field>

                  {/* honeypot — hidden from real users */}
                  <input
                    type="checkbox"
                    name="botcheck"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    className="hidden"
                    checked={false}
                    onChange={(e) => setBotcheck(e.target.checked ? "on" : "")}
                    style={{ display: "none" }}
                  />

                  {status === "error" ? (
                    <p
                      role="alert"
                      className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-red-700"
                    >
                      <TriangleAlert
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        {statusMessage}{" "}
                        Or reach us directly at{" "}
                        <a
                          href={`mailto:${CONTACT_EMAIL}`}
                          className="font-medium underline underline-offset-2"
                        >
                          {CONTACT_EMAIL}
                        </a>
                        .
                      </span>
                    </p>
                  ) : null}

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={status === "sending"}
                      className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand-600 px-5.5 py-2.5 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(11,99,67,0.25),inset_0_1px_0_rgba(255,255,255,0.14)] transition-all duration-200 hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {status === "sending" ? (
                        <>
                          <Loader2
                            className="size-3.5 animate-spin"
                            aria-hidden="true"
                          />
                          Sending…
                        </>
                      ) : (
                        <>
                          <Send className="size-3.5" aria-hidden="true" />
                          Send message
                        </>
                      )}
                    </button>
                    <p className="text-[12px] text-ink-mute">
                      Arrives in our inbox within seconds.
                    </p>
                  </div>
                </form>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </SubpageShell>
  );
}
