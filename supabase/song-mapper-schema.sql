-- Song Mapper cloud library schema for Supabase.
-- Run this in the Supabase SQL editor, then paste your project URL and anon key
-- into SUPABASE_URL and SUPABASE_ANON_KEY in song-mapper/index.html.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.song_maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  artist text,
  description text,
  tags text[] not null default '{}',
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  schema_version int not null default 2,
  map_data jsonb not null,
  source_map_id uuid references public.song_maps(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.song_map_versions (
  id uuid primary key default gen_random_uuid(),
  song_map_id uuid not null references public.song_maps(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  map_data jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists song_maps_set_updated_at on public.song_maps;
create trigger song_maps_set_updated_at
before update on public.song_maps
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.song_maps enable row level security;
alter table public.song_map_versions enable row level security;

drop policy if exists "Public profiles are readable" on public.profiles;
create policy "Public profiles are readable"
on public.profiles for select
using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Public song maps are readable" on public.song_maps;
create policy "Public song maps are readable"
on public.song_maps for select
using (visibility = 'public' or auth.uid() = owner_id);

drop policy if exists "Users can insert their own song maps" on public.song_maps;
create policy "Users can insert their own song maps"
on public.song_maps for insert
with check (auth.uid() = owner_id);

drop policy if exists "Owners can update their own song maps" on public.song_maps;
create policy "Owners can update their own song maps"
on public.song_maps for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "Owners can delete their own song maps" on public.song_maps;
create policy "Owners can delete their own song maps"
on public.song_maps for delete
using (auth.uid() = owner_id);

drop policy if exists "Public song map versions are readable" on public.song_map_versions;
create policy "Public song map versions are readable"
on public.song_map_versions for select
using (
  exists (
    select 1
    from public.song_maps
    where song_maps.id = song_map_versions.song_map_id
      and (song_maps.visibility = 'public' or song_maps.owner_id = auth.uid())
  )
);

drop policy if exists "Owners can insert versions for their own maps" on public.song_map_versions;
create policy "Owners can insert versions for their own maps"
on public.song_map_versions for insert
with check (
  auth.uid() = created_by
  and exists (
    select 1
    from public.song_maps
    where song_maps.id = song_map_versions.song_map_id
      and song_maps.owner_id = auth.uid()
  )
);

create index if not exists song_maps_visibility_updated_idx
on public.song_maps (visibility, updated_at desc);

create index if not exists song_maps_owner_updated_idx
on public.song_maps (owner_id, updated_at desc);

create index if not exists song_maps_tags_idx
on public.song_maps using gin (tags);
