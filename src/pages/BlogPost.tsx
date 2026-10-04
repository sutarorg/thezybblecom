import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { Navbar } from "../sections/Navbar";
import { Footer } from "../sections/Closing";
import { Reveal } from "../components/primitives";
import { AuthCta } from "../components/AuthCta";
import { NotFoundPage } from "../app/pages/NotFound";
import {
  formatPostDate,
  getPostBySlug,
  getRelatedPosts,
  readingTimeMinutes,
  tableOfContents,
  type BlogPost,
} from "../blog";
import { Inline, SectionView } from "../blog/render";
import { usePageSeo } from "../lib/hooks";
import { blogPostMeta } from "../seo/meta";

function Breadcrumbs({ post }: { post: BlogPost }) {
  return (
    <nav aria-label="Breadcrumb" className="pt-8 sm:pt-10">
      <ol className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-mute">
        <li>
          <Link to="/" className="transition-colors hover:text-ink">
            Home
          </Link>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="size-3 text-neutral-300" />
        </li>
        <li>
          <Link to="/blog" className="transition-colors hover:text-ink">
            Blog
          </Link>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="size-3 text-neutral-300" />
        </li>
        <li aria-current="page" className="max-w-[22ch] truncate font-medium text-ink-soft sm:max-w-none">
          {post.title}
        </li>
      </ol>
    </nav>
  );
}

function Toc({ post }: { post: BlogPost }) {
  const entries = tableOfContents(post);
  if (entries.length < 3) return null;
  return (
    <nav
      aria-label="On this page"
      className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
    >
      <p className="text-[10.5px] font-semibold tracking-[0.14em] text-ink-mute uppercase">
        On this page
      </p>
      <ol className="mt-3 space-y-2">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="block text-[12.5px] leading-5 text-ink-mute transition-colors hover:text-brand-700"
            >
              {entry.heading}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function RelatedCard({ post }: { post: BlogPost }) {
  return (
    <li className="h-full">
      <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow duration-300 hover:shadow-ui-sm">
        <img
          src={post.thumbnail}
          alt={post.thumbnailAlt}
          width={post.thumbnailWidth}
          height={post.thumbnailHeight}
          loading="lazy"
          decoding="async"
          className="aspect-video w-full border-b border-black/[0.05] object-cover"
        />
        <div className="flex flex-1 flex-col p-5">
          <p className="text-[11.5px] font-semibold text-brand-700">{post.category}</p>
          <h3 className="font-display mt-2 text-balance text-[15.5px] leading-[1.3] font-semibold tracking-[-0.015em] text-ink">
            <Link to={`/blog/${post.slug}`} className="after:absolute after:inset-0">
              {post.title}
            </Link>
          </h3>
          <p className="mt-auto flex items-center gap-1.5 pt-3 text-[12px] text-ink-mute">
            {readingTimeMinutes(post)} min read
            <ArrowRight
              className="size-3 transition-transform duration-300 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </p>
        </div>
      </article>
    </li>
  );
}

function ArticleView({ post }: { post: BlogPost }) {
  usePageSeo(blogPostMeta(post));
  const related = getRelatedPosts(post);

  return (
    <>
      <Navbar />
      <main id="main" className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Breadcrumbs post={post} />

        {/* header */}
        <header className="mx-auto mt-8 max-w-[760px] sm:mt-10">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-mute">
            <span className="font-semibold text-brand-700">{post.category}</span>
            <span aria-hidden="true">·</span>
            <span>{readingTimeMinutes(post)} min read</span>
          </p>
          <h1 className="font-display mt-3.5 text-balance text-[1.85rem] leading-[1.12] font-semibold tracking-[-0.035em] text-ink min-[480px]:text-[2.2rem] sm:text-[2.7rem] sm:leading-[1.08]">
            {post.title}
          </h1>
          <div className="mt-5 space-y-3.5">
            {post.intro.map((paragraph, i) => (
              <p key={i} className="text-pretty text-[15.5px] leading-7.5 text-ink-mute sm:text-[16.5px] sm:leading-8">
                <Inline text={paragraph} />
              </p>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/[0.06] pt-5 text-[12.5px] text-ink-mute">
            <span className="font-medium text-ink-soft">{post.author.name}</span>
            <span aria-hidden="true" className="text-neutral-300">|</span>
            <span>
              Published <time dateTime={post.datePublished}>{formatPostDate(post.datePublished)}</time>
            </span>
            {post.dateModified && post.dateModified !== post.datePublished ? (
              <span>
                · Updated <time dateTime={post.dateModified}>{formatPostDate(post.dateModified)}</time>
              </span>
            ) : null}
          </div>
        </header>

        {/* hero illustration */}
        <figure className="mx-auto mt-8 max-w-[920px] sm:mt-10">
          <img
            src={post.thumbnail}
            alt={post.thumbnailAlt}
            width={post.thumbnailWidth}
            height={post.thumbnailHeight}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="w-full rounded-[22px] ring-1 ring-black/[0.06] sm:rounded-[26px]"
          />
        </figure>

        {/* body + toc */}
        <div className="mx-auto mt-10 grid max-w-[920px] gap-10 sm:mt-14 lg:max-w-none lg:grid-cols-12 lg:gap-12">
          <div className="order-2 min-w-0 lg:order-1 lg:col-span-8 lg:col-start-2">
            <article className="mx-auto max-w-[720px]">
              {post.sections.map((section) => (
                <SectionView key={section.id} section={section} />
              ))}

              {/* authorship + transparency */}
              <footer className="mt-12 rounded-2xl border border-black/[0.06] bg-white px-5 py-4.5 sm:px-6">
                <p className="text-[12.5px] leading-5.5 text-ink-mute">
                  <span className="font-semibold text-ink-soft">{post.author.name}.</span>{" "}
                  {post.author.role}. We write these guides from what we learn
                  building and using Zybble; the team drafts, edits, and
                  fact-checks every article (with AI assistance for research
                  and the illustrations), and updates it when the subject
                  changes.
                </p>
                <Link
                  to="/blog"
                  className="group mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700 transition-colors hover:text-brand-600"
                >
                  <ArrowLeft
                    className="size-3.5 transition-transform duration-300 group-hover:-translate-x-0.5"
                    aria-hidden="true"
                  />
                  All articles
                </Link>
              </footer>
            </article>
          </div>

          <aside className="order-1 lg:order-2 lg:col-span-3">
            <div className="lg:sticky lg:top-20">
              <Toc post={post} />
            </div>
          </aside>
        </div>

        {/* CTA */}
        <Reveal className="mx-auto mt-14 max-w-[920px] sm:mt-20">
          <aside
            aria-label="Try Zybble"
            className="flex flex-col items-start justify-between gap-5 rounded-[24px] bg-white p-7 ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:flex-row sm:items-center sm:p-9"
          >
            <div>
              <h2 className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink sm:text-[21px]">
                Build your first lead list today.
              </h2>
              <p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-ink-mute">
                Describe the businesses you need in plain language — Zybble
                finds them and structures the data. Free plan, 50 leads a month.
              </p>
            </div>
            <AuthCta className="shrink-0 px-5.5 py-2.5 text-[14px]" />
          </aside>
        </Reveal>

        {/* related */}
        {related.length > 0 ? (
          <section aria-labelledby="related-title" className="mx-auto mt-14 max-w-[920px] sm:mt-16">
            <h2
              id="related-title"
              className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink"
            >
              Keep reading
            </h2>
            <ul className="mt-5 grid gap-5 sm:grid-cols-3">
              {related.map((relatedPost) => (
                <RelatedCard key={relatedPost.slug} post={relatedPost} />
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  );
}

export default function BlogPostPage() {
  const { slug = "" } = useParams();
  const post = getPostBySlug(slug);
  if (!post) return <NotFoundPage />;
  return <ArticleView post={post} />;
}
