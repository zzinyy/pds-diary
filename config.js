// 공개해도 되는 값만 둡니다.
// SUPABASE_ANON_KEY는 "익명 공개용" 키로, Supabase 설계상 프론트에 노출되어도 안전합니다.
// (진짜 비밀인 DB 비밀번호 / service_role 키는 여기 절대 넣지 않습니다.)
export const SUPABASE_URL = "https://ceawpldbzxgzqpfoxgjn.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlYXdwbGRienhnenFwZm94Z2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMjQ5NDcsImV4cCI6MjEwNTYwMDk0N30.BWQNRtYliP1Gtf6R1CPkZgyQeHpdd615JRRs3Vgfxfo";

// 이번 과제는 계획을 1건만 다룬다 (여러 계획 확장은 이후 과제 대비 스키마만 열어둠).
export const CURRENT_PLAN_ID = "plan-001";