-- Close authorization gaps from the 2026-10-11 vulnerability scan.
-- Invite acceptance, prompt reveal, subscription tier, promo codes, digest keys,
-- time zones, habit completions, presence posts, memories, storage, and RPCs.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  return btrim(p_text)::uuid;
exception
  when others then
    return null;
end;
$$;

revoke all on function public.safe_uuid(text) from public, anon, authenticated;
grant execute on function public.safe_uuid(text) to authenticated, service_role;

create or replace function public.safe_time_zone(p_tz text)
returns text
language plpgsql
stable
as $$
declare
  z text := nullif(btrim(coalesce(p_tz, '')), '');
begin
  if z is null then
    return 'UTC';
  end if;
  perform timezone(z, now());
  return z;
exception
  when others then
    return 'UTC';
end;
$$;

revoke all on function public.safe_time_zone(text) from public, anon, authenticated;
grant execute on function public.safe_time_zone(text) to service_role;

-- ---------------------------------------------------------------------------
-- Invite acceptance: one locked transaction, max two members, consume first
-- ---------------------------------------------------------------------------
create or replace function public.enforce_couple_member_cap()
returns trigger
language plpgsql
as $$
declare
  n int;
begin
  perform 1 from public.couples where id = new.couple_id for update;
  select count(*)::int into n
  from public.couple_members
  where couple_id = new.couple_id;
  if n >= 2 then
    raise exception 'couple_full';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_couple_member_cap() from public, anon, authenticated;

drop trigger if exists couple_members_enforce_cap on public.couple_members;

create trigger couple_members_enforce_cap
before insert on public.couple_members
for each row
execute function public.enforce_couple_member_cap();

create or replace function public.accept_couple_invite(p_token text, p_acceptor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites%rowtype;
  cpl public.couples%rowtype;
  member_count int;
  reunion timestamptz;
  partner_id uuid;
  partner_first text;
  partner_display text;
begin
  if p_acceptor_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  if p_token is null or length(btrim(p_token)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'token_required');
  end if;

  select * into inv
  from public.invites
  where token = btrim(p_token)
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invite_not_found');
  end if;

  if inv.consumed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invite_already_used');
  end if;

  if inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'invite_expired');
  end if;

  if inv.inviter_id = p_acceptor_id then
    return jsonb_build_object('ok', false, 'error', 'cannot_accept_own_invite');
  end if;

  if exists (
    select 1
    from public.couple_members cm
    join public.couples c on c.id = cm.couple_id
    where cm.user_id = p_acceptor_id
      and c.is_complete
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_paired');
  end if;

  select * into cpl
  from public.couples
  where id = inv.couple_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invite_not_found');
  end if;

  select count(*)::int into member_count
  from public.couple_members
  where couple_id = cpl.id;

  if cpl.is_complete or member_count >= 2 then
    return jsonb_build_object('ok', false, 'error', 'couple_full');
  end if;

  if exists (
    select 1
    from public.couple_members
    where couple_id = cpl.id
      and user_id = p_acceptor_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  update public.invites
  set consumed_at = now(),
      consumed_by_user_id = p_acceptor_id
  where id = inv.id
    and consumed_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invite_already_used');
  end if;

  insert into public.couple_members (couple_id, user_id)
  values (cpl.id, p_acceptor_id);

  reunion := now() + interval '42 days';

  update public.couples
  set is_complete = true,
      reunion_date = coalesce(reunion_date, reunion)
  where id = cpl.id
    and is_complete = false;

  if not found then
    raise exception 'couple_update_failed';
  end if;

  select cm.user_id into partner_id
  from public.couple_members cm
  where cm.couple_id = cpl.id
    and cm.user_id <> p_acceptor_id
  limit 1;

  if partner_id is null then
    raise exception 'partner_not_found';
  end if;

  select p.first_name, p.display_name
  into partner_first, partner_display
  from public.profiles p
  where p.id = partner_id;

  return jsonb_build_object(
    'ok', true,
    'couple', jsonb_build_object(
      'id', cpl.id,
      'meId', p_acceptor_id,
      'partner', jsonb_build_object(
        'id', partner_id,
        'firstName', coalesce(nullif(btrim(partner_first), ''), 'Partner'),
        'displayName', partner_display
      ),
      'reunionDate', coalesce(cpl.reunion_date, reunion)
    )
  );
end;
$$;

revoke all on function public.accept_couple_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_couple_invite(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Profiles: clients cannot change subscription tier; time zones must be IANA
-- ---------------------------------------------------------------------------
revoke update (subscription_tier) on table public.profiles from anon, authenticated;

create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
as $$
declare
  z text;
begin
  if new.subscription_tier is distinct from old.subscription_tier
     and current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception 'subscription_tier_immutable';
  end if;

  if new.time_zone is distinct from old.time_zone then
    z := nullif(btrim(coalesce(new.time_zone, '')), '');
    if z is null then
      new.time_zone := null;
    else
      begin
        perform timezone(z, now());
      exception
        when others then
          raise exception 'invalid_time_zone';
      end;
      new.time_zone := z;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_guard_privileged_columns() from public, anon, authenticated;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;

create trigger profiles_guard_privileged_columns
before update on public.profiles
for each row
execute function public.profiles_guard_privileged_columns();

-- ---------------------------------------------------------------------------
-- Promo codes: server-side rows, expiry, single use, caller only by default
-- ---------------------------------------------------------------------------
create table if not exists public.promo_codes (
  code text primary key,
  expires_at timestamptz not null,
  max_redemptions integer not null default 1 check (max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  grants_partner boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists promo_codes_code_upper_idx
  on public.promo_codes (upper(code));

create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.promo_codes (code),
  user_id uuid not null references auth.users (id) on delete cascade,
  couple_id uuid references public.couples (id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (code, user_id)
);

alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;

revoke all on table public.promo_codes from public, anon, authenticated;
revoke all on table public.promo_redemptions from public, anon, authenticated;
grant select, insert, update, delete on table public.promo_codes to service_role;
grant select, insert, update, delete on table public.promo_redemptions to service_role;

create or replace function public.redeem_plus_promo(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rec public.promo_codes%rowtype;
  couple_id_found uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  if p_code is null or length(btrim(p_code)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  select * into rec
  from public.promo_codes
  where upper(code) = upper(btrim(p_code))
  for update;

  if not found
     or rec.active is not true
     or rec.expires_at <= now()
     or rec.redemption_count >= rec.max_redemptions then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  select c.id into couple_id_found
  from public.couples c
  join public.couple_members cm on cm.couple_id = c.id
  where cm.user_id = uid
    and c.is_complete
  limit 1;

  begin
    insert into public.promo_redemptions (code, user_id, couple_id)
    values (rec.code, uid, couple_id_found);
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end;

  update public.promo_codes
  set redemption_count = redemption_count + 1
  where code = rec.code
    and redemption_count < max_redemptions;

  if not found then
    raise exception 'promo_exhausted';
  end if;

  if rec.grants_partner and couple_id_found is not null then
    update public.profiles p
    set subscription_tier = 'premium'
    from public.couple_members cm
    where cm.couple_id = couple_id_found
      and cm.user_id = p.id;
  else
    update public.profiles
    set subscription_tier = 'premium'
    where id = uid;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.redeem_plus_promo(text) from public, anon;
grant execute on function public.redeem_plus_promo(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Prompt answers stay private until the prompt is revealed
-- ---------------------------------------------------------------------------
drop policy if exists prompt_answers_select on public.prompt_answers;

create policy prompt_answers_select on public.prompt_answers
  for select using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.couple_prompts cp
      where cp.id = prompt_answers.couple_prompt_id
        and cp.is_revealed = true
        and cp.couple_id in (select public.user_couple_ids())
    )
  );

-- Partner id only, so the client can show a blurred panel without the answer body or photo.
create or replace function public.hidden_prompt_partner(p_prompt_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  partner uuid;
begin
  if uid is null or p_prompt_id is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.couple_prompts cp
    where cp.id = p_prompt_id
      and cp.is_revealed is not true
      and cp.couple_id in (select public.user_couple_ids())
  ) then
    return null;
  end if;

  select pa.user_id into partner
  from public.prompt_answers pa
  where pa.couple_prompt_id = p_prompt_id
    and pa.user_id <> uid
  limit 1;

  return partner;
end;
$$;

revoke all on function public.hidden_prompt_partner(uuid) from public, anon;
grant execute on function public.hidden_prompt_partner(uuid) to authenticated;

create or replace function public.couple_prompts_guard_insert()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if new.prompt_date is distinct from (timezone('utc', now()))::date then
      raise exception 'couple_prompt_date_not_today';
    end if;
    new.is_revealed := false;
  end if;
  return new;
end;
$$;

revoke all on function public.couple_prompts_guard_insert() from public, anon, authenticated;

drop trigger if exists couple_prompts_guard_insert on public.couple_prompts;

create trigger couple_prompts_guard_insert
before insert on public.couple_prompts
for each row
execute function public.couple_prompts_guard_insert();

create or replace function public.couple_prompts_guard_update()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception 'couple_prompt_update_forbidden';
  end if;

  if new.question is distinct from old.question
     or new.category is distinct from old.category
     or new.prompt_date is distinct from old.prompt_date
     or new.couple_id is distinct from old.couple_id
  then
    if exists (
      select 1
      from public.prompt_answers pa
      where pa.couple_prompt_id = old.id
    ) then
      raise exception 'couple_prompt_locked_after_answer';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.couple_prompts_guard_update() from public, anon, authenticated;

drop trigger if exists couple_prompts_guard_update on public.couple_prompts;

create trigger couple_prompts_guard_update
before update on public.couple_prompts
for each row
execute function public.couple_prompts_guard_update();

drop policy if exists couple_prompts_update on public.couple_prompts;
drop policy if exists couple_prompts_delete on public.couple_prompts;

-- ---------------------------------------------------------------------------
-- Habit completions: delete and update only the caller's own rows
-- ---------------------------------------------------------------------------
drop policy if exists habit_completions_all on public.habit_completions;

create policy habit_completions_select on public.habit_completions
  for select using (
    habit_id in (
      select h.id from public.habits h
      where h.couple_id in (select public.user_couple_ids())
    )
  );

create policy habit_completions_insert on public.habit_completions
  for insert with check (
    habit_id in (
      select h.id from public.habits h
      where h.couple_id in (select public.user_couple_ids())
    )
    and user_id = auth.uid()
  );

create policy habit_completions_update on public.habit_completions
  for update using (
    habit_id in (
      select h.id from public.habits h
      where h.couple_id in (select public.user_couple_ids())
    )
    and user_id = auth.uid()
  ) with check (
    habit_id in (
      select h.id from public.habits h
      where h.couple_id in (select public.user_couple_ids())
    )
    and user_id = auth.uid()
  );

create policy habit_completions_delete on public.habit_completions
  for delete using (
    habit_id in (
      select h.id from public.habits h
      where h.couple_id in (select public.user_couple_ids())
    )
    and user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Presence posts: author-only edits; identity columns stay immutable
-- ---------------------------------------------------------------------------
drop policy if exists presence_posts_update on public.presence_posts;

create policy presence_posts_update on public.presence_posts
  for update using (
    couple_id in (select public.user_couple_ids())
    and author_id = auth.uid()
  ) with check (
    couple_id in (select public.user_couple_ids())
    and author_id = auth.uid()
  );

create or replace function public.presence_posts_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.couple_id is distinct from old.couple_id
     or new.author_id is distinct from old.author_id
     or new.storage_path is distinct from old.storage_path
     or new.created_at is distinct from old.created_at
  then
    raise exception 'presence_post_columns_immutable';
  end if;

  if current_user in ('anon', 'authenticated', 'authenticator')
     and (
       new.caption is distinct from old.caption
       or new.mood is distinct from old.mood
       or new.location_label is distinct from old.location_label
     )
     and auth.uid() is distinct from old.author_id
  then
    raise exception 'presence_post_author_only';
  end if;

  return new;
end;
$$;

revoke all on function public.presence_posts_guard_update() from public, anon, authenticated;

drop trigger if exists presence_posts_guard_update on public.presence_posts;

create trigger presence_posts_guard_update
before update on public.presence_posts
for each row
execute function public.presence_posts_guard_update();

create or replace function public.increment_presence_reaction(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  updated int;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  update public.presence_posts p
  set reaction_count = p.reaction_count + 1
  where p.id = p_post_id
    and public.is_member_of_couple(p.couple_id, uid);

  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'post_not_found';
  end if;
end;
$$;

revoke all on function public.increment_presence_reaction(uuid) from public, anon;
grant execute on function public.increment_presence_reaction(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Memories: clients cannot insert milestone (or any) rows; favorites only
-- ---------------------------------------------------------------------------
drop policy if exists memories_all on public.memories;

create policy memories_select on public.memories
  for select using (couple_id in (select public.user_couple_ids()));

create policy memories_update on public.memories
  for update using (couple_id in (select public.user_couple_ids()))
  with check (couple_id in (select public.user_couple_ids()));

create or replace function public.memories_guard_update()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if new.id is distinct from old.id
       or new.couple_id is distinct from old.couple_id
       or new.type is distinct from old.type
       or new.title is distinct from old.title
       or new.summary is distinct from old.summary
       or new.deep_link_ref is distinct from old.deep_link_ref
       or new.milestone_kind is distinct from old.milestone_kind
       or new.image_storage_path is distinct from old.image_storage_path
       or new.created_at is distinct from old.created_at
    then
      raise exception 'memories_columns_immutable';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.memories_guard_update() from public, anon, authenticated;

drop trigger if exists memories_guard_update on public.memories;

create trigger memories_guard_update
before update on public.memories
for each row
execute function public.memories_guard_update();

create or replace function public.notify_couple_milestone_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_uid uuid;
  wants boolean;
  cat text;
  note_title text;
  note_summary text;
begin
  if new.type is distinct from 'milestone' then
    return new;
  end if;

  note_title := case new.milestone_kind
    when 'anniversary' then 'Anniversary'
    when 'trip' then 'Reunion update'
    when 'streak_win' then 'Streak milestone'
    else 'New milestone'
  end;

  note_summary := case new.milestone_kind
    when 'anniversary' then 'An anniversary was added to your timeline.'
    when 'trip' then 'A reunion update was added to your timeline.'
    when 'streak_win' then 'A streak milestone was added to your timeline.'
    else 'A milestone was added to your timeline.'
  end;

  for member_uid in
    select cm.user_id from public.couple_members cm where cm.couple_id = new.couple_id
  loop
    cat := 'habit';
    wants := true;

    if new.milestone_kind = 'anniversary' then
      cat := 'anniversary';
      select coalesce(p.anniversaries, true) into wants
      from public.user_notification_prefs p
      where p.user_id = member_uid;
    elsif new.milestone_kind = 'trip' then
      cat := 'countdown';
      select coalesce(p.countdown_updates, true) into wants
      from public.user_notification_prefs p
      where p.user_id = member_uid;
    else
      select coalesce(p.milestones, true) into wants
      from public.user_notification_prefs p
      where p.user_id = member_uid;
    end if;

    if wants is false then
      continue;
    end if;

    perform public.internal_insert_notification(
      member_uid,
      cat,
      note_title,
      note_summary,
      '/(app)/(tabs)/timeline'
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.notify_couple_milestone_memory() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Notifications: no client inserts; inbox taps only follow fixed paths
-- ---------------------------------------------------------------------------
drop policy if exists notifications_insert on public.notifications;

create or replace function public.notifications_guard_update()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.category is distinct from old.category
       or new.title is distinct from old.title
       or new.summary is distinct from old.summary
       or new.href is distinct from old.href
       or new.created_at is distinct from old.created_at
       or new.push_dispatched_at is distinct from old.push_dispatched_at
    then
      raise exception 'notifications_columns_immutable';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.notifications_guard_update() from public, anon, authenticated;

drop trigger if exists notifications_guard_update on public.notifications;

create trigger notifications_guard_update
before update on public.notifications
for each row
execute function public.notifications_guard_update();

create or replace function public.internal_insert_notification(
  p_user_id uuid,
  p_category text,
  p_title text,
  p_summary text,
  p_href text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_href is not null
     and p_href !~ '^/\(app\)/(\(tabs\)/(home|photos|timeline|calendar)|prompt/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'
  then
    raise exception 'invalid_notification_href';
  end if;

  insert into public.notifications (user_id, category, title, summary, href)
  values (p_user_id, p_category, p_title, p_summary, p_href);
end;
$$;

revoke all on function public.internal_insert_notification(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.internal_insert_notification(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Digest keys are service-only; invalid zones fall back per user
-- ---------------------------------------------------------------------------
alter table public.notification_digest_keys enable row level security;

revoke all on table public.notification_digest_keys from public, anon, authenticated;
grant select, insert, delete on table public.notification_digest_keys to service_role;

create or replace function public.run_notification_digest_job()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  tz text;
  local_d date;
  local_h int;
  cp record;
  wants boolean;
  ins_cnt int;
  h record;
  c record;
  reunion_local date;
  days int;
  milestone int;
begin
  for r in
    select p.id as user_id, p.time_zone as profile_tz
    from public.profiles p
    where exists (select 1 from public.couple_members cm where cm.user_id = p.id)
  loop
    begin
      tz := public.safe_time_zone(r.profile_tz);
      local_d := (timezone(tz, now()))::date;
      local_h := extract(hour from timezone(tz, now()))::int;

      if local_h >= 20 then
        for cp in
          select cp2.id as prompt_id, cp2.couple_id
          from public.couple_prompts cp2
          join public.couple_members cm2 on cm2.couple_id = cp2.couple_id and cm2.user_id = r.user_id
          where cp2.prompt_date = local_d
            and not exists (
              select 1 from public.prompt_answers pa
              where pa.couple_prompt_id = cp2.id and pa.user_id = r.user_id
            )
        loop
          with ins as (
            insert into public.notification_digest_keys (user_id, dedupe_key)
            values (r.user_id, 'unanswered_eod:' || cp.prompt_id::text || ':' || local_d::text)
            on conflict do nothing
            returning 1
          )
          select count(*)::int into ins_cnt from ins;

          if ins_cnt > 0 then
            select coalesce(p.unanswered_prompt, true) into wants
            from public.user_notification_prefs p
            where p.user_id = r.user_id;

            if wants is true then
              perform public.internal_insert_notification(
                r.user_id,
                'prompt',
                'Daily prompt waiting',
                'You have not answered today''s question yet.',
                '/(app)/prompt/' || cp.prompt_id::text
              );
            end if;
          end if;
        end loop;
      end if;

      if local_h = 18 then
        for h in
          select hab.id as habit_id, hab.couple_id
          from public.habits hab
          join public.couple_members cm3 on cm3.couple_id = hab.couple_id and cm3.user_id = r.user_id
          where hab.type = 'ours'
            and not exists (
              select 1 from public.habit_completions hc
              where hc.habit_id = hab.id
                and hc.user_id = r.user_id
                and hc.ymd = local_d
            )
        loop
          with ins as (
            insert into public.notification_digest_keys (user_id, dedupe_key)
            values (r.user_id, 'habit_open:' || h.habit_id::text || ':' || local_d::text)
            on conflict do nothing
            returning 1
          )
          select count(*)::int into ins_cnt from ins;

          if ins_cnt > 0 then
            select coalesce(p.habit_reminder, true) into wants
            from public.user_notification_prefs p
            where p.user_id = r.user_id;

            if wants is true then
              perform public.internal_insert_notification(
                r.user_id,
                'habit',
                'Habit check-in',
                'A shared habit is still open for today.',
                '/(app)/(tabs)/calendar'
              );
            end if;
          end if;
        end loop;
      end if;

      if local_h = 9 then
        for c in
          select coup.id as couple_id, coup.created_at
          from public.couples coup
          join public.couple_members cm4 on cm4.couple_id = coup.id and cm4.user_id = r.user_id
          where coup.is_complete is true
            and extract(month from timezone(tz, coup.created_at))::int = extract(month from timezone(tz, now()))::int
            and extract(day from timezone(tz, coup.created_at))::int = extract(day from timezone(tz, now()))::int
        loop
          with ins as (
            insert into public.notification_digest_keys (user_id, dedupe_key)
            values (
              r.user_id,
              'anniv:' || c.couple_id::text || ':' || extract(year from timezone(tz, now()))::text
            )
            on conflict do nothing
            returning 1
          )
          select count(*)::int into ins_cnt from ins;

          if ins_cnt > 0 then
            select coalesce(p.anniversaries, true) into wants
            from public.user_notification_prefs p
            where p.user_id = r.user_id;

            if wants is true then
              perform public.internal_insert_notification(
                r.user_id,
                'anniversary',
                'Happy LoveDistance anniversary',
                'Celebrating the day you joined as a couple here.',
                '/(app)/(tabs)/timeline'
              );
            end if;
          end if;
        end loop;
      end if;

      if local_h = 10 then
        for c in
          select coup.id as couple_id, coup.reunion_date
          from public.couples coup
          join public.couple_members cm5 on cm5.couple_id = coup.id and cm5.user_id = r.user_id
          where coup.reunion_date is not null
        loop
          reunion_local := (timezone(tz, c.reunion_date))::date;
          days := reunion_local - local_d;

          if days in (0, 1, 7, 30) then
            milestone := days;
          else
            continue;
          end if;

          with ins as (
            insert into public.notification_digest_keys (user_id, dedupe_key)
            values (
              r.user_id,
              'countdown:' || c.couple_id::text || ':' || reunion_local::text || ':' || milestone::text
            )
            on conflict do nothing
            returning 1
          )
          select count(*)::int into ins_cnt from ins;

          if ins_cnt > 0 then
            select coalesce(p.countdown_updates, true) into wants
            from public.user_notification_prefs p
            where p.user_id = r.user_id;

            if wants is true then
              perform public.internal_insert_notification(
                r.user_id,
                'countdown',
                case milestone
                  when 0 then 'Reunion day'
                  when 1 then 'One day to reunion'
                  else 'Reunion countdown'
                end,
                case milestone
                  when 0 then 'Enjoy every moment together.'
                  when 1 then 'Almost there—one day left.'
                  when 7 then 'One week until you are together.'
                  when 30 then 'One month until reunion.'
                  else 'Reunion is coming up.'
                end,
                '/(app)/(tabs)/home'
              );
            end if;
          end if;
        end loop;
      end if;
    exception
      when others then
        raise warning 'run_notification_digest_job skipped user %: %', r.user_id, sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.run_notification_digest_job() from public, anon, authenticated;
grant execute on function public.run_notification_digest_job() to service_role;
grant execute on function public.run_notification_digest_job() to postgres;

revoke all on function public.refresh_couple_prompt_reveal(uuid) from public, anon, authenticated;
grant execute on function public.refresh_couple_prompt_reveal(uuid) to service_role;

revoke all on function public.notification_partner_for_couple(uuid, uuid) from public, anon, authenticated;
grant execute on function public.notification_partner_for_couple(uuid, uuid) to service_role;

revoke all on function public.notify_partner_prompt_first_answer() from public, anon, authenticated;
revoke all on function public.notify_partner_prompt_reaction() from public, anon, authenticated;
revoke all on function public.notify_author_prompt_reply_reaction() from public, anon, authenticated;
revoke all on function public.sync_memory_from_presence_post() from public, anon, authenticated;
revoke all on function public.sync_memory_from_prompt_reveal() from public, anon, authenticated;
revoke all on function public.notify_partner_new_presence_photo() from public, anon, authenticated;
revoke all on function public.seed_default_habits_for_couple(uuid) from public, anon, authenticated;
revoke all on function public.couple_members_seed_habits() from public, anon, authenticated;
revoke all on function public.prompt_answers_touch_reveal() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private avatars, owner-only overwrites, hidden prompt photos
-- ---------------------------------------------------------------------------
update storage.buckets
set public = false
where id = 'avatars';

drop policy if exists avatars_objects_select on storage.objects;

create policy avatars_objects_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or exists (
        select 1
        from public.couple_members me
        join public.couples c on c.id = me.couple_id and c.is_complete
        join public.couple_members them
          on them.couple_id = me.couple_id
         and them.user_id::text = split_part(name, '/', 1)
        where me.user_id = auth.uid()
          and them.user_id <> auth.uid()
      )
    )
  );

drop policy if exists presence_objects_update on storage.objects;
drop policy if exists presence_objects_delete on storage.objects;

create policy presence_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'presence'
    and (owner = auth.uid() or owner_id = auth.uid()::text)
    and (storage.foldername(name))[1] = 'couple'
    and public.is_member_of_couple(public.safe_uuid((storage.foldername(name))[2]), auth.uid())
  )
  with check (
    bucket_id = 'presence'
    and (owner = auth.uid() or owner_id = auth.uid()::text)
    and (storage.foldername(name))[1] = 'couple'
    and public.is_member_of_couple(public.safe_uuid((storage.foldername(name))[2]), auth.uid())
  );

create policy presence_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'presence'
    and (owner = auth.uid() or owner_id = auth.uid()::text)
    and (storage.foldername(name))[1] = 'couple'
    and public.is_member_of_couple(public.safe_uuid((storage.foldername(name))[2]), auth.uid())
  );

drop policy if exists prompt_attachments_objects_select on storage.objects;
drop policy if exists prompt_attachments_objects_update on storage.objects;
drop policy if exists prompt_attachments_objects_delete on storage.objects;

create policy prompt_attachments_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'prompt_attachments'
    and (storage.foldername(name))[1] = 'couple'
    and public.is_member_of_couple(public.safe_uuid((storage.foldername(name))[2]), auth.uid())
    and (
      owner = auth.uid()
      or owner_id = auth.uid()::text
      or exists (
        select 1
        from public.couple_prompts cp
        where cp.id = public.safe_uuid((storage.foldername(name))[3])
          and cp.couple_id = public.safe_uuid((storage.foldername(name))[2])
          and cp.is_revealed = true
      )
    )
  );

create policy prompt_attachments_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'prompt_attachments'
    and (owner = auth.uid() or owner_id = auth.uid()::text)
    and (storage.foldername(name))[1] = 'couple'
    and public.is_member_of_couple(public.safe_uuid((storage.foldername(name))[2]), auth.uid())
  )
  with check (
    bucket_id = 'prompt_attachments'
    and (owner = auth.uid() or owner_id = auth.uid()::text)
    and (storage.foldername(name))[1] = 'couple'
    and public.is_member_of_couple(public.safe_uuid((storage.foldername(name))[2]), auth.uid())
  );

create policy prompt_attachments_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'prompt_attachments'
    and (owner = auth.uid() or owner_id = auth.uid()::text)
    and (storage.foldername(name))[1] = 'couple'
    and public.is_member_of_couple(public.safe_uuid((storage.foldername(name))[2]), auth.uid())
  );
