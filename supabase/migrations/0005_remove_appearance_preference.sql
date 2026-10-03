-- ===========================================================================
-- 0005 — Remove the appearance preference.
--
-- Zybble is light-mode only: the theme is pinned in the client (see
-- src/app/lib/datetime.ts + src/index.css) and can no longer be switched by
-- users or by the operating system. The stored `appearance` column is
-- obsolete, so it is dropped. Safe to run on any environment: the client no
-- longer reads or writes the column, whether or not this migration has been
-- applied.
-- ===========================================================================

alter table user_preferences
  drop column if exists appearance;
