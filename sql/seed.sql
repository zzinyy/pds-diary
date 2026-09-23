-- 실제 데이터 채우기 (본인이 알려준 실제 계획/할 일/실행 기록)
-- schema.sql을 먼저 실행한 뒤, 이 파일을 SQL Editor에서 실행하세요.
-- 두 번 실행해도 안전하도록 upsert(on conflict) 방식으로 작성했습니다.

-- ------------------------------
-- 계획
-- ------------------------------
insert into plans (id, title, category, start_date, end_date, success_criteria, estimated_hours, priority, note)
values (
  'plan-001',
  'ALEPH 진행 - AI/보안 교육',
  '교육/ALEPH 진행',
  '2026-08-11',
  '2026-11-12',
  '교육 수료',
  500,
  '상',
  '리눅스마스터2급(9/12 시험), 면접 3건(8/18, 8/31, 9/11) 포함'
)
on conflict (id) do update set
  title = excluded.title,
  category = excluded.category,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  success_criteria = excluded.success_criteria,
  estimated_hours = excluded.estimated_hours,
  priority = excluded.priority,
  note = excluded.note;

-- 최초 버전 스냅샷(v1)도 남겨서 "고쳐도 처음 계획이 남는다"를 처음부터 만족시켜 둡니다.
insert into plan_revisions (plan_id, version_no, snapshot)
select 'plan-001', 1, to_jsonb(p) from plans p where p.id = 'plan-001'
  and not exists (select 1 from plan_revisions r where r.plan_id = 'plan-001' and r.version_no = 1);

-- ------------------------------
-- 할 일 (7건)
-- ------------------------------
insert into todos (id, plan_id, title, deadline, period_note, priority, tag, estimated_hours, status, completed_at)
values
  ('t-001', 'plan-001', 'ALEPH 수업 출석', '2026-11-12', '2026-08-11~2026-11-12 매 수업일', '중', 'ALEPH', 500, '진행중', null),
  ('t-002', 'plan-001', 'ALEPH 과제 제출',  '2026-11-12', '', '중', 'ALEPH', 100, '진행중', null),
  ('t-003', 'plan-001', '리눅스마스터 2급 실기 공부', '2026-09-12', '준비 기간 2026-08-30~2026-09-12', '중', '리눅스마스터', 30, '완료', '2026-09-12T12:00:00+09:00'),
  ('t-004', 'plan-001', '리눅스마스터 2급 시험 응시', '2026-09-12', '', '중', '리눅스마스터', 2, '완료', '2026-09-12T18:00:00+09:00'),
  ('t-006', 'plan-001', '8/18 면접 참석', '2026-08-18', '준비 기간 4일', '상', '면접', 1, '완료', '2026-08-18T18:00:00+09:00'),
  ('t-007', 'plan-001', '8/31 면접 참석', '2026-08-31', '준비 기간 3일', '상', '면접', 1, '완료', '2026-08-31T18:00:00+09:00'),
  ('t-008', 'plan-001', '9/11 면접 참석', '2026-09-11', '준비 기간 3일', '상', '면접', 1, '완료', '2026-09-11T18:00:00+09:00')
on conflict (id) do update set
  title = excluded.title,
  deadline = excluded.deadline,
  period_note = excluded.period_note,
  priority = excluded.priority,
  tag = excluded.tag,
  estimated_hours = excluded.estimated_hours,
  status = excluded.status,
  completed_at = excluded.completed_at;

-- ------------------------------
-- 실행 기록 (5건) — 모두 'ALEPH 과제 제출'(t-002)의 세부 작업
-- ------------------------------
insert into executions (id, todo_id, start_at, end_at, actual_hours, blocker_reason, note)
values
  ('e-001', 't-002', '2026-09-10T20:00:00+09:00', '2026-09-12T22:00:00+09:00', 5, '깃허브 연동', '과제1 - 나를 소개하는 한 페이지'),
  ('e-002', 't-002', '2026-09-12T20:00:00+09:00', '2026-09-15T22:00:00+09:00', 6, '게임 종류 선택', '과제2 - 내가 설계한 미니게임'),
  ('e-003', 't-002', '2026-09-15T20:00:00+09:00', '2026-09-16T22:00:00+09:00', 7, '', '과제3 - 짤,카드 스튜디오'),
  ('e-004', 't-002', '2026-09-16T20:00:00+09:00', '2026-09-17T22:00:00+09:00', 8, '날씨 연동', '과제4 - 오늘의 진짜 정보판(데이터가 안 올 때)'),
  ('e-005', 't-002', '2026-09-17T20:00:00+09:00', '2026-09-18T22:00:00+09:00', 5, '과제 이해', '과제5 - 대화가 끊겨도 이어지는 프로젝트')
on conflict (id) do update set
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  actual_hours = excluded.actual_hours,
  blocker_reason = excluded.blocker_reason,
  note = excluded.note;
