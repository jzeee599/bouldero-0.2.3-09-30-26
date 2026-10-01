-- Version 0.2.2B: distinguish ground starts, partial starts, and Hold 0.
alter table public.attempts
  add column started_hold_id uuid references public.holds(id) on delete set null;

create index attempts_started_hold on public.attempts(started_hold_id)
  where started_hold_id is not null;
