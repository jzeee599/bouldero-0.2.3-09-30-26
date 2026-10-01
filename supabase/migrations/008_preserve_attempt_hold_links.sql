-- Version 0.2.3F: retain attempt references when a saved hold map is edited.
-- Migration 007 deleted every hold before reinserting it. Because attempt hold
-- foreign keys use ON DELETE SET NULL, that erased historical progress even
-- when the same hold ID remained in the edited map.

create or replace function public.update_project_v5(
  p_id uuid, p_name text, p_grade text, p_gym text, p_holds jsonb,
  p_finish_type text, p_notes text, p_purpose text
)
returns void language plpgsql security invoker set search_path = public as $$
declare hold_count integer; tracking_mode text;
begin
  select route_mode into tracking_mode
    from public.projects
    where id = p_id and user_id = auth.uid();
  if tracking_mode is null then raise exception 'Line not found'; end if;
  if p_finish_type not in ('hold', 'top_out') then raise exception 'Invalid finish type'; end if;
  if p_purpose not in ('project', 'warm_up', 'training') then raise exception 'Invalid line purpose'; end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'Notes are too long'; end if;
  if jsonb_typeof(p_holds) <> 'array' then raise exception 'Holds must be an array'; end if;
  hold_count := jsonb_array_length(p_holds);
  if tracking_mode = 'mapped' and (hold_count < 1 or hold_count > 200) then raise exception 'Add between 1 and 200 holds'; end if;
  if tracking_mode = 'count_only' and hold_count <> 0 then raise exception 'Reps-only lines cannot contain mapped holds'; end if;
  if exists (
    select 1
      from jsonb_array_elements(p_holds) with ordinality as h(value, n)
      where (value->>'order_index')::integer is distinct from n::integer
         or ((value->>'is_top')::boolean and n <> hold_count)
  ) then raise exception 'Holds must be consecutive; only the final hold can be TOP'; end if;

  update public.projects
    set name = trim(p_name),
        grade = nullif(trim(p_grade), ''),
        gym = nullif(trim(p_gym), ''),
        finish_type = p_finish_type,
        notes = trim(coalesce(p_notes, '')),
        purpose = p_purpose
    where id = p_id and user_id = auth.uid();

  -- Avoid the one-TOP partial index conflicting while the retained rows move.
  update public.holds set is_top = false where project_id = p_id;

  insert into public.holds(id, project_id, order_index, x, y, is_top)
    select (h->>'id')::uuid,
           p_id,
           (h->>'order_index')::integer,
           (h->>'x')::double precision,
           (h->>'y')::double precision,
           (h->>'is_top')::boolean
      from jsonb_array_elements(p_holds) h
  on conflict (id) do update
    set order_index = excluded.order_index,
        x = excluded.x,
        y = excluded.y,
        is_top = excluded.is_top
    where public.holds.project_id = p_id;

  -- Only genuinely removed holds are deleted; their attempt links correctly
  -- become null through the existing foreign-key rule.
  delete from public.holds
    where project_id = p_id
      and id not in (
        select (h->>'id')::uuid from jsonb_array_elements(p_holds) h
      );
end; $$;

revoke all on function public.update_project_v5(uuid,text,text,text,jsonb,text,text,text) from public, anon;
grant execute on function public.update_project_v5(uuid,text,text,text,jsonb,text,text,text) to authenticated;
