-- Version 0.2.2D: explicit line purpose and owner-safe hold editing.
alter table public.projects
  add column purpose text not null default 'project'
    check (purpose in ('project', 'warm_up', 'training'));

create function public.create_project_v5(
  p_id uuid, p_name text, p_grade text, p_gym text, p_photo text,
  p_holds jsonb, p_route_mode text, p_source_project_id uuid,
  p_finish_type text, p_notes text, p_purpose text
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare hold_count integer; final_photo text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_route_mode not in ('mapped', 'count_only') then raise exception 'Invalid tracking mode'; end if;
  if p_finish_type not in ('hold', 'top_out') then raise exception 'Invalid finish type'; end if;
  if p_purpose not in ('project', 'warm_up', 'training') then raise exception 'Invalid line purpose'; end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'Notes are too long'; end if;
  if jsonb_typeof(p_holds) <> 'array' then raise exception 'Holds must be an array'; end if;
  hold_count := jsonb_array_length(p_holds);
  if p_source_project_id is not null then
    if p_photo is not null then raise exception 'A reused line cannot upload another photo'; end if;
    select photo_url into final_photo from public.projects where id = p_source_project_id and user_id = auth.uid();
    if final_photo is null then raise exception 'Photo source not found'; end if;
  else
    if p_photo is null or p_photo <> auth.uid()::text || '/' || p_id::text || '.jpg' then raise exception 'Invalid photo path'; end if;
    final_photo := p_photo;
  end if;
  if p_route_mode = 'mapped' and (hold_count < 1 or hold_count > 200) then raise exception 'Add between 1 and 200 holds'; end if;
  if p_route_mode = 'count_only' and hold_count <> 0 then raise exception 'Reps-only lines cannot contain mapped holds'; end if;
  if exists (select 1 from jsonb_array_elements(p_holds) with ordinality as h(value, n)
    where (value->>'order_index')::integer is distinct from n::integer
       or ((value->>'is_top')::boolean and n <> hold_count))
  then raise exception 'Holds must be consecutive; only the final hold can be TOP'; end if;
  insert into public.users(id) values(auth.uid()) on conflict(id) do nothing;
  insert into public.projects(id,user_id,name,grade,gym,photo_url,route_mode,source_project_id,finish_type,notes,purpose)
    values(p_id,auth.uid(),trim(p_name),nullif(trim(p_grade),''),nullif(trim(p_gym),''),final_photo,p_route_mode,p_source_project_id,p_finish_type,trim(coalesce(p_notes,'')),p_purpose);
  insert into public.holds(id,project_id,order_index,x,y,is_top)
    select (h->>'id')::uuid,p_id,(h->>'order_index')::integer,(h->>'x')::double precision,(h->>'y')::double precision,(h->>'is_top')::boolean
    from jsonb_array_elements(p_holds) h;
  return p_id;
end; $$;

create function public.update_project_v5(
  p_id uuid, p_name text, p_grade text, p_gym text, p_holds jsonb,
  p_finish_type text, p_notes text, p_purpose text
)
returns void language plpgsql security invoker set search_path = public as $$
declare hold_count integer; tracking_mode text;
begin
  select route_mode into tracking_mode from public.projects where id = p_id and user_id = auth.uid();
  if tracking_mode is null then raise exception 'Line not found'; end if;
  if p_finish_type not in ('hold', 'top_out') then raise exception 'Invalid finish type'; end if;
  if p_purpose not in ('project', 'warm_up', 'training') then raise exception 'Invalid line purpose'; end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'Notes are too long'; end if;
  hold_count := jsonb_array_length(p_holds);
  if tracking_mode = 'mapped' and (hold_count < 1 or hold_count > 200) then raise exception 'Add between 1 and 200 holds'; end if;
  if tracking_mode = 'count_only' and hold_count <> 0 then raise exception 'Reps-only lines cannot contain mapped holds'; end if;
  update public.projects set name=trim(p_name),grade=nullif(trim(p_grade),''),gym=nullif(trim(p_gym),''),finish_type=p_finish_type,notes=trim(coalesce(p_notes,'')),purpose=p_purpose where id=p_id and user_id=auth.uid();
  delete from public.holds where project_id=p_id;
  insert into public.holds(id,project_id,order_index,x,y,is_top)
    select (h->>'id')::uuid,p_id,(h->>'order_index')::integer,(h->>'x')::double precision,(h->>'y')::double precision,(h->>'is_top')::boolean from jsonb_array_elements(p_holds) h;
end; $$;

revoke all on function public.create_project_v5(uuid,text,text,text,text,jsonb,text,uuid,text,text,text) from public, anon;
grant execute on function public.create_project_v5(uuid,text,text,text,text,jsonb,text,uuid,text,text,text) to authenticated;
revoke all on function public.update_project_v5(uuid,text,text,text,jsonb,text,text,text) from public, anon;
grant execute on function public.update_project_v5(uuid,text,text,text,jsonb,text,text,text) to authenticated;
