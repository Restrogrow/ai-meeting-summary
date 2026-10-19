-- Already applied to your Supabase project. Keep for reference / new projects.
create table if not exists meetings (
  id bigint generated always as identity primary key,
  title text not null,
  created_at timestamptz not null default now(),
  overview text,
  decisions jsonb not null default '[]',
  action_items jsonb not null default '[]',
  questions jsonb not null default '[]',
  transcript text
);
alter table meetings enable row level security;

-- Saved recordings + summary status (run once in Supabase → SQL Editor)
alter table meetings add column if not exists status text not null default 'done'
  check (status in ('processing', 'done', 'failed'));
alter table meetings add column if not exists error text;
alter table meetings add column if not exists audio_path text;

-- Summaries on request only: new "saved" status (run once in Supabase → SQL Editor)
alter table meetings drop constraint if exists meetings_status_check;
alter table meetings add constraint meetings_status_check
  check (status in ('saved', 'processing', 'done', 'failed'));
alter table meetings add column if not exists summary_requested_at timestamptz;
