-- 플랜두씨 다이어리 1 — 스키마 (과제 6)
-- Supabase SQL Editor에 이 파일 전체를 붙여넣고 실행하세요.
-- 이번 과제는 로그인이 없으므로 RLS를 "누구나 읽기/쓰기 가능"으로 열어둡니다.
-- 잠그는 작업(로그인 붙이고 RLS를 본인 것만 보이게 좁히는 것)은 7번 과제에서 합니다.

-- ---------------------------------------------------------------
-- 0. 확장 (id 생성용)
-- ---------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- 1. plans — 계획
-- ---------------------------------------------------------------
create table if not exists plans (
  id                text primary key,
  title             text not null,
  category          text,
  start_date        date not null,
  end_date          date not null,
  success_criteria  text not null default '',
  estimated_hours   numeric not null default 0,
  priority          text not null default '중' check (priority in ('상','중','하')),
  note              text default '',
  carryover_note    text default '',   -- 돌아보기에서 다음 계획으로 넘기는 한 줄
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 2. plan_revisions — 계획 수정 이력 (고치기 전 값을 스냅샷으로 보관)
-- ---------------------------------------------------------------
create table if not exists plan_revisions (
  id          bigint generated always as identity primary key,
  plan_id     text not null references plans(id) on delete cascade,
  version_no  int not null,
  snapshot    jsonb not null,   -- 고치기 '전' plans 행 전체
  saved_at    timestamptz not null default now()
);
create index if not exists idx_plan_revisions_plan on plan_revisions(plan_id, version_no);

-- ---------------------------------------------------------------
-- 3. todos — 할 일
-- ---------------------------------------------------------------
create table if not exists todos (
  id                text primary key,
  plan_id           text not null references plans(id) on delete cascade,
  title             text not null,
  deadline          date,
  period_note       text default '',   -- 기간형 할 일(예: 매 수업일)의 보조 설명
  priority          text not null default '중' check (priority in ('상','중','하')),
  tag               text default '',
  estimated_hours   numeric not null default 0,
  status            text not null default '진행중' check (status in ('진행중','완료')),
  deleted           boolean not null default false,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_todos_plan on todos(plan_id);
create index if not exists idx_todos_status on todos(status);
create index if not exists idx_todos_deleted on todos(deleted);

-- ---------------------------------------------------------------
-- 4. executions — 실행 기록 (실제로 한 일)
-- ---------------------------------------------------------------
create table if not exists executions (
  id              text primary key,
  todo_id         text not null references todos(id) on delete cascade,
  start_at        timestamptz,
  end_at          timestamptz,
  actual_hours    numeric not null default 0,
  blocker_reason  text default '',
  note            text default '',   -- 무엇을 했는지 짧은 설명(선택)
  created_at      timestamptz not null default now()
);
create index if not exists idx_executions_todo on executions(todo_id);

-- ---------------------------------------------------------------
-- 5. RLS — 지금은 로그인이 없으므로 전부 열어둠 (7번 과제에서 잠글 예정)
-- ---------------------------------------------------------------
alter table plans enable row level security;
alter table plan_revisions enable row level security;
alter table todos enable row level security;
alter table executions enable row level security;

drop policy if exists "anon_all_plans" on plans;
create policy "anon_all_plans" on plans for all using (true) with check (true);

drop policy if exists "anon_all_plan_revisions" on plan_revisions;
create policy "anon_all_plan_revisions" on plan_revisions for all using (true) with check (true);

drop policy if exists "anon_all_todos" on todos;
create policy "anon_all_todos" on todos for all using (true) with check (true);

drop policy if exists "anon_all_executions" on executions;
create policy "anon_all_executions" on executions for all using (true) with check (true);

-- ---------------------------------------------------------------
-- 6. updated_at 자동 갱신 트리거
-- ---------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_plans_updated_at on plans;
create trigger trg_plans_updated_at before update on plans
  for each row execute function set_updated_at();

drop trigger if exists trg_todos_updated_at on todos;
create trigger trg_todos_updated_at before update on todos
  for each row execute function set_updated_at();
