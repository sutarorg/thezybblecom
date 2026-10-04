import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Navbar } from "../sections/Navbar";
import { Footer } from "../sections/Closing";
import { Eyebrow, Reveal } from "../components/primitives";
import { AuthCta } from "../components/AuthCta";
import {
  FEATURED_POST,
  POSTS,
  formatPostDate,
  readingTimeMinutes,
  type BlogPost,
} from "../blog";
import { usePageSeo } from "../lib/hooks";
import { blogIndexMeta } from "../seo/meta";

function PostMetaLine({ post, className }: { post: BlogPost; className?: string }) {
  return (
    <p className={className ?? "flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-mute"}>
      <span className="font-semibold text-brand-700">{post.category}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={post.datePublished}>{formatPostDate(post.datePublished)}</time>
      <span aria-hidden="true">·</span>
      <span>{readingTimeMinutes(post)} min read</span>
    </p>
  );
}

function FeaturedCard({ post }: { post: BlogPost }) {
  return (
    <Reveal>
      <article className="group relative grid overflow-hidden rounded-[24px] bg-white ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow duration-300 hover:shadow-ui-sm sm:rounded-[28px] md:grid-cols-2">
        <div className="relative overflow-hidden border-b border-black/[0.05] md:border-r md:border-b-0">
          <img
            src={post.thumbnail}
            alt={post.thumbnailAlt}
            width={post.thumbnailWidth}
            height={post.thumbnailHeight}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex flex-col justify-center p-6 sm:p-9 lg:p-11">
          <PostMetaLine post={post} />
          <h2 className="font-display mt-3 text-balance text-[1.45rem] leading-[1.15] font-semibold tracking-[-0.03em] text-ink sm:text-[1.75rem]">
            <Link to={`/blog/${post.slug}`} className="after:absolute after:inset-0">
              {post.title}
            </Link>
          </h2>
          <p className="mt-3.5 max-w-md text-pretty text-[14px] leading-6.5 text-ink-mute sm:text-[14.5px] sm:leading-7">
            {post.excerpt}
          </p>
          <span className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-700 transition-colors group-hover:text-brand-600">
            Read article
            <ArrowRight
              className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
        </div>
      </article>
    </Reveal>
  );
}

function PostCard({ post, delay }: { post: BlogPost; delay: number }) {
  return (
    <Reveal as="li" delay={delay} className="h-full">
      <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow duration-300 hover:shadow-ui-sm">
        <div className="overflow-hidden border-b border-black/[0.05]">
          <img
            src={post.thumbnail}
            alt={post.thumbnailAlt}
            width={post.thumbnailWidth}
            height={post.thumbnailHeight}
            loading="lazy"
            decoding="async"
            className="aspect-video w-full object-cover"
          />
        </div>
        <div className="flex flex-1 flex-col p-5 sm:p-6">
          <PostMetaLine post={post} />
          <h3 className="font-display mt-2.5 text-balance text-[17px] leading-[1.3] font-semibold tracking-[-0.02em] text-ink sm:text-[18px]">
            <Link to={`/blog/${post.slug}`} className="after:absolute after:inset-0">
              {post.title}
            </Link>
          </h3>
          <p className="mt-2.5 line-clamp-3 text-[13.5px] leading-6 text-ink-mute">
            {post.excerpt}
          </p>
          <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[13px] font-semibold text-brand-700 transition-colors group-hover:text-brand-600">
            Read article
            <ArrowRight
              className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
        </div>
      </article>
    </Reveal>
  );
}

export default function BlogPage() {
  usePageSeo(blogIndexMeta());
  const rest = POSTS.filter((post) => post.slug !== FEATURED_POST.slug);

  return (
    <>
      <Navbar />
      <main id="main" className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <header className="pt-16 sm:pt-20 md:pt-24">
          <Reveal>
            <Eyebrow>Blog</Eyebrow>
          </Reveal>
          <Reveal delay={70}>
            <h1 className="font-display mt-4 text-balance text-[2.15rem] leading-[1.08] font-semibold tracking-[-0.04em] text-ink min-[480px]:text-[2.8rem] sm:text-6xl sm:leading-[1.04]">
              Notes on finding
              <br className="hidden sm:block" /> business leads.
            </h1>
          </Reveal>
          <Reveal delay={130}>
            <p className="mt-5 max-w-xl text-pretty text-[15px] leading-7 text-ink-mute sm:text-[16px]">
              Practical guides to lead discovery, prospecting, and business
              data — written by the team building Zybble. No fluff, no
              recycled listicles; just the processes we'd use ourselves.
            </p>
          </Reveal>
        </header>

        <div className="mt-10 sm:mt-14">
          <FeaturedCard post={FEATURED_POST} />
        </div>

        <ul className="mt-6 grid gap-6 sm:grid-cols-2" aria-label="More articles">
          {rest.map((post, i) => (
            <PostCard key={post.slug} post={post} delay={60 * (i % 2)} />
          ))}
        </ul>

        {/* product CTA — present but calm */}
        <Reveal className="mt-14 sm:mt-20">
          <aside
            aria-label="Try Zybble"
            className="flex flex-col items-start justify-between gap-5 rounded-[24px] bg-white p-7 ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:flex-row sm:items-center sm:p-9"
          >
            <div>
              <h2 className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink sm:text-[21px]">
                Put the guides to work.
              </h2>
              <p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-ink-mute">
                Describe the businesses you need in one sentence — Zybble
                builds the lead list. Free plan, 50 leads a month.
              </p>
            </div>
            <AuthCta className="shrink-0 px-5.5 py-2.5 text-[14px]" />
          </aside>
        </Reveal>
      </main>
      <Footer />
    </>
  );
}
