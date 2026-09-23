import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, CURRENT_PLAN_ID } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------
function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function todayKST() {
  // YYYY-MM-DD in Asia/Seoul
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function fmtDateKST(dateStr) {
  if (!dateStr) return "-";
  return dateStr; // already YYYY-MM-DD, timezone-less date; shown as-is
}

function fmtDateTimeKST(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d);
  } catch { return iso; }
}

function nowIsoKST() {
  return new Date().toISOString();
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function shortId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

const PRIORITY_RANK = { "상": 0, "중": 1, "하": 2 };

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
const state = {
  plan: null,
  todos: [],
  executions: [],
  revisions: [],
  planEditMode: false,
  todoFilters: { search: "", status: "전체", priority: "전체", tag: "전체", sortKey: "deadline", sortDir: "asc" },
  reviewPeriod: { start: null, end: null },
  reviewDrill: null, // {kind, items}
  busyToggle: new Set(),
};

// ---------------------------------------------------------------
// Data access
// ---------------------------------------------------------------
async function loadAll() {
  const [{ data: plan, error: pErr }, { data: todos, error: tErr }, { data: revisions }] = await Promise.all([
    supabase.from("plans").select("*").eq("id", CURRENT_PLAN_ID).single(),
    supabase.from("todos").select("*").eq("plan_id", CURRENT_PLAN_ID).eq("deleted", false),
    supabase.from("plan_revisions").select("*").eq("plan_id", CURRENT_PLAN_ID).order("version_no", { ascending: false }),
  ]);
  if (pErr) { toast("계획 로드 실패: " + pErr.message); return; }
  if (tErr) { toast("할 일 로드 실패: " + tErr.message); return; }
  state.plan = plan;
  state.todos = todos || [];
  state.revisions = revisions || [];

  const todoIds = state.todos.map((t) => t.id);
  if (todoIds.length) {
    const { data: execs, error: eErr } = await supabase.from("executions").select("*").in("todo_id", todoIds);
    if (eErr) { toast("실행기록 로드 실패: " + eErr.message); }
    state.executions = execs || [];
  } else {
    state.executions = [];
  }

  if (!state.reviewPeriod.start && plan) {
    state.reviewPeriod.start = plan.start_date;
    state.reviewPeriod.end = plan.end_date;
  }
}

async function savePlanEdit(patch) {
  const { data: current, error: gErr } = await supabase.from("plans").select("*").eq("id", CURRENT_PLAN_ID).single();
  if (gErr) { toast("저장 실패: " + gErr.message); return; }

  const nextVersion = (state.revisions[0]?.version_no || 0) + 1;
  const { error: rErr } = await supabase.from("plan_revisions").insert({
    plan_id: CURRENT_PLAN_ID,
    version_no: nextVersion,
    snapshot: current,
  });
  if (rErr) { toast("이력 저장 실패: " + rErr.message); return; }

  const { error: uErr } = await supabase.from("plans").update(patch).eq("id", CURRENT_PLAN_ID);
  if (uErr) { toast("계획 수정 실패: " + uErr.message); return; }

  toast("계획을 수정했습니다. (고치기 전 내용은 수정 이력에 남아있어요)");
  await loadAll();
  render();
}

async function addTodo(fields) {
  const row = {
    id: shortId("t"),
    plan_id: CURRENT_PLAN_ID,
    title: fields.title,
    deadline: fields.deadline || null,
    period_note: fields.period_note || "",
    priority: fields.priority,
    tag: fields.tag || "",
    estimated_hours: Number(fields.estimated_hours) || 0,
    status: "진행중",
    deleted: false,
  };
  const { error } = await supabase.from("todos").insert(row);
  if (error) { toast("할 일 추가 실패: " + error.message); return; }
  toast("할 일을 추가했습니다.");
  await loadAll();
  render();
}

async function updateTodo(id, patch) {
  const { error } = await supabase.from("todos").update(patch).eq("id", id);
  if (error) { toast("수정 실패: " + error.message); return; }
  await loadAll();
  render();
}

async function deleteTodo(id) {
  if (!confirm("이 할 일을 삭제할까요?")) return;
  const { error } = await supabase.from("todos").update({ deleted: true }).eq("id", id);
  if (error) { toast("삭제 실패: " + error.message); return; }
  toast("삭제했습니다.");
  await loadAll();
  render();
}

async function toggleComplete(id) {
  if (state.busyToggle.has(id)) return; // 연달아 두 번 눌러도 한 번만 처리
  state.busyToggle.add(id);
  try {
    const { data: row, error: gErr } = await supabase.from("todos").select("status").eq("id", id).single();
    if (gErr) { toast("확인 실패: " + gErr.message); return; }
    if (row.status === "완료") return; // 이미 완료 -> 아무 것도 안 함 (중복 방지)
    const { error } = await supabase.from("todos").update({ status: "완료", completed_at: nowIsoKST() }).eq("id", id);
    if (error) { toast("완료 처리 실패: " + error.message); return; }
    toast("완료 처리했습니다.");
    await loadAll();
    render();
  } finally {
    state.busyToggle.delete(id);
  }
}

async function uncomplete(id) {
  const { error } = await supabase.from("todos").update({ status: "진행중", completed_at: null }).eq("id", id);
  if (error) { toast("되돌리기 실패: " + error.message); return; }
  toast("진행 중으로 되돌렸습니다.");
  await loadAll();
  render();
}

async function addExecution(fields) {
  const row = {
    id: shortId("e"),
    todo_id: fields.todo_id,
    start_at: fields.start_at ? new Date(fields.start_at).toISOString() : null,
    end_at: fields.end_at ? new Date(fields.end_at).toISOString() : null,
    actual_hours: Number(fields.actual_hours) || 0,
    blocker_reason: fields.blocker_reason || "",
    note: fields.note || "",
  };
  const { error } = await supabase.from("executions").insert(row);
  if (error) { toast("실행 기록 추가 실패: " + error.message); return; }
  toast("실행 기록을 추가했습니다. (계획 값은 그대로입니다)");
  await loadAll();
  render();
}

async function saveCarryover(text) {
  const { error } = await supabase.from("plans").update({ carryover_note: text }).eq("id", CURRENT_PLAN_ID);
  if (error) { toast("저장 실패: " + error.message); return; }
  toast("다음 계획으로 넘길 한 줄을 저장했습니다.");
  await loadAll();
  render();
}

async function exportAll() {
  const [{ data: plans }, { data: revisions }, { data: todos }, { data: executions }] = await Promise.all([
    supabase.from("plans").select("*"),
    supabase.from("plan_revisions").select("*"),
    supabase.from("todos").select("*"),
    supabase.from("executions").select("*"),
  ]);
  const payload = { exported_at: new Date().toISOString(), plans, plan_revisions: revisions, todos, executions };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pds-diary-export-${todayKST()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("내보내기 완료");
}

// ---------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------
function blockersByTodo(todoId) {
  return state.executions.filter((e) => e.todo_id === todoId && e.blocker_reason && e.blocker_reason.trim() !== "");
}

function execsByTodo(todoId) {
  return state.executions.filter((e) => e.todo_id === todoId);
}

function filteredSortedTodos() {
  const f = state.todoFilters;
  let list = state.todos.slice();
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    list = list.filter((t) => (t.title || "").toLowerCase().includes(q) || (t.tag || "").toLowerCase().includes(q));
  }
  if (f.status !== "전체") list = list.filter((t) => t.status === f.status);
  if (f.priority !== "전체") list = list.filter((t) => t.priority === f.priority);
  if (f.tag !== "전체") list = list.filter((t) => t.tag === f.tag);

  const dir = f.sortDir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let av, bv;
    if (f.sortKey === "deadline") { av = a.deadline || "9999-99-99"; bv = b.deadline || "9999-99-99"; }
    else if (f.sortKey === "priority") { av = PRIORITY_RANK[a.priority] ?? 9; bv = PRIORITY_RANK[b.priority] ?? 9; }
    else if (f.sortKey === "estimated_hours") { av = a.estimated_hours; bv = b.estimated_hours; }
    else { av = a.created_at; bv = b.created_at; }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // 동률일 때도 항상 같은 순서
  });
  return list;
}

function distinctTags() {
  return [...new Set(state.todos.map((t) => t.tag).filter(Boolean))];
}

function computeReview() {
  const { start, end } = state.reviewPeriod;
  const target = state.todos.filter((t) => {
    if (!t.deadline) return true;
    if (start && t.deadline < start) return false;
    if (end && t.deadline > end) return false;
    return true;
  });
  const today = todayKST();
  const planCount = target.length;
  const doneItems = target.filter((t) => t.status === "완료");
  const delayedItems = target.filter((t) => t.status !== "완료" && t.deadline && t.deadline < today);
  const blockedItems = target.filter((t) => blockersByTodo(t.id).length > 0);
  const estSum = target.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
  const targetIds = new Set(target.map((t) => t.id));
  const actSum = state.executions
    .filter((e) => targetIds.has(e.todo_id))
    .reduce((s, e) => s + (Number(e.actual_hours) || 0), 0);
  const diff = actSum - estSum;
  return { target, planCount, doneItems, delayedItems, blockedItems, estSum, actSum, diff };
}

// ---------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------
function priorityBadge(p) {
  const cls = p === "상" ? "p-high" : p === "중" ? "p-mid" : "p-low";
  return `<span class="badge ${cls}">${esc(p)}</span>`;
}
function statusBadge(s) {
  return `<span class="badge ${s === "완료" ? "done" : "doing"}">${esc(s)}</span>`;
}

function renderPlan() {
  const el = document.getElementById("panel-plan");
  const p = state.plan;
  if (!p) { el.innerHTML = `<div class="empty">불러오는 중...</div>`; return; }

  if (!state.planEditMode) {
    el.innerHTML = `
      <div class="card">
        <div class="row between">
          <h2>${esc(p.title)}</h2>
          <button class="btn" id="btn-edit-plan">수정</button>
        </div>
        <div class="field-grid">
          <div><label>활동 구분</label>${esc(p.category)}</div>
          <div><label>기간</label>${esc(p.start_date)} ~ ${esc(p.end_date)}</div>
          <div><label>우선순위</label>${priorityBadge(p.priority)}</div>
          <div><label>예상 총 소요 시간</label>${esc(p.estimated_hours)}h</div>
          <div style="grid-column:1/-1"><label>성공 기준</label>${esc(p.success_criteria)}</div>
          <div style="grid-column:1/-1"><label>비고</label>${esc(p.note) || "-"}</div>
        </div>
      </div>
      <div class="card">
        <div class="row between">
          <h3>수정 이력 (${state.revisions.length}건)</h3>
        </div>
        ${state.revisions.length === 0
          ? `<div class="muted">아직 수정한 적이 없습니다.</div>`
          : state.revisions.map((r) => `
              <div class="history-item">
                <div class="when">v${esc(r.version_no)} · 수정 직전 저장됨 · ${esc(fmtDateTimeKST(r.saved_at))}</div>
                <div>제목: ${esc(r.snapshot.title)} / 성공기준: ${esc(r.snapshot.success_criteria)} / 예상시간: ${esc(r.snapshot.estimated_hours)}h / 우선순위: ${esc(r.snapshot.priority)}</div>
              </div>
            `).join("")}
      </div>
    `;
    document.getElementById("btn-edit-plan").onclick = () => { state.planEditMode = true; render(); };
  } else {
    el.innerHTML = `
      <div class="card">
        <h2>계획 수정</h2>
        <form id="form-plan-edit" class="field-grid">
          <div><label>제목</label><input name="title" value="${esc(p.title)}" required /></div>
          <div><label>활동 구분</label><input name="category" value="${esc(p.category)}" /></div>
          <div><label>시작일</label><input type="date" name="start_date" value="${esc(p.start_date)}" required /></div>
          <div><label>종료일</label><input type="date" name="end_date" value="${esc(p.end_date)}" required /></div>
          <div><label>우선순위</label>
            <select name="priority">
              ${["상", "중", "하"].map((v) => `<option value="${v}" ${p.priority === v ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </div>
          <div><label>예상 총 소요 시간(h)</label><input type="number" step="0.5" name="estimated_hours" value="${esc(p.estimated_hours)}" required /></div>
          <div style="grid-column:1/-1"><label>성공 기준</label><textarea name="success_criteria">${esc(p.success_criteria)}</textarea></div>
          <div style="grid-column:1/-1"><label>비고</label><textarea name="note">${esc(p.note)}</textarea></div>
          <div class="row" style="grid-column:1/-1">
            <button type="submit" class="btn primary">저장 (이전 내용은 이력에 보관됩니다)</button>
            <button type="button" class="btn" id="btn-cancel-plan">취소</button>
          </div>
        </form>
      </div>
    `;
    document.getElementById("btn-cancel-plan").onclick = () => { state.planEditMode = false; render(); };
    document.getElementById("form-plan-edit").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const patch = Object.fromEntries(fd.entries());
      patch.estimated_hours = Number(patch.estimated_hours);
      state.planEditMode = false;
      savePlanEdit(patch);
    };
  }
}

function renderTodos() {
  const el = document.getElementById("panel-todos");
  const f = state.todoFilters;
  const list = filteredSortedTodos();
  const tags = distinctTags();
  const sortLabelMap = { deadline: "마감일", priority: "우선순위", estimated_hours: "예상 시간", created_at: "생성일" };

  el.innerHTML = `
    <div class="card">
      <h3>할 일 추가</h3>
      <form id="form-add-todo" class="field-grid">
        <div style="grid-column:1/-1"><label>할 일</label><input name="title" required placeholder="예: 리눅스마스터 실기 문제풀이" /></div>
        <div><label>마감일</label><input type="date" name="deadline" /></div>
        <div><label>우선순위</label>
          <select name="priority"><option value="중" selected>중</option><option value="상">상</option><option value="하">하</option></select>
        </div>
        <div><label>태그</label><input name="tag" placeholder="예: 리눅스마스터" /></div>
        <div><label>예상 시간(h)</label><input type="number" step="0.5" name="estimated_hours" value="0" /></div>
        <div style="grid-column:1/-1"><label>보조 설명(선택, 예: 반복/준비기간)</label><input name="period_note" /></div>
        <div style="grid-column:1/-1"><button type="submit" class="btn primary">추가</button></div>
      </form>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:10px;">
        <input id="f-search" placeholder="검색 (제목/태그)" value="${esc(f.search)}" style="max-width:200px" />
        <select id="f-status">
          ${["전체", "진행중", "완료"].map((v) => `<option ${f.status === v ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <select id="f-priority">
          ${["전체", "상", "중", "하"].map((v) => `<option ${f.priority === v ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <select id="f-tag">
          <option value="전체" ${f.tag === "전체" ? "selected" : ""}>태그 전체</option>
          ${tags.map((t) => `<option value="${esc(t)}" ${f.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}
        </select>
        <select id="f-sortkey">
          ${Object.entries(sortLabelMap).map(([k, v]) => `<option value="${k}" ${f.sortKey === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <select id="f-sortdir">
          <option value="asc" ${f.sortDir === "asc" ? "selected" : ""}>오름차순</option>
          <option value="desc" ${f.sortDir === "desc" ? "selected" : ""}>내림차순</option>
        </select>
      </div>
      <div class="hint">정렬 기준: ${sortLabelMap[f.sortKey]} ${f.sortDir === "asc" ? "오름차순" : "내림차순"} (값이 같으면 ID 순으로 고정)</div>
      <div class="table-wrap" style="margin-top:10px;">
        <table>
          <thead><tr><th>할 일</th><th>마감일</th><th>우선순위</th><th>태그</th><th>예상(h)</th><th>실제(h)</th><th>상태</th><th></th></tr></thead>
          <tbody>
            ${list.length === 0 ? `<tr><td colspan="8" class="empty">조건에 맞는 할 일이 없습니다.</td></tr>` : list.map((t) => {
              const actual = execsByTodo(t.id).reduce((s, e) => s + (Number(e.actual_hours) || 0), 0);
              const blocked = blockersByTodo(t.id).length > 0;
              return `
              <tr data-id="${esc(t.id)}">
                <td class="wrap-text">${esc(t.title)}${t.period_note ? `<div class="muted">${esc(t.period_note)}</div>` : ""}${blocked ? `<div class="muted">⚠ 막힘 기록 있음</div>` : ""}</td>
                <td>${esc(fmtDateKST(t.deadline))}</td>
                <td>${priorityBadge(t.priority)}</td>
                <td>${esc(t.tag) || "-"}</td>
                <td>${esc(t.estimated_hours)}</td>
                <td>${actual}</td>
                <td>${statusBadge(t.status)}</td>
                <td>
                  <div class="row">
                    <button class="btn small btn-edit">수정</button>
                    ${t.status === "완료"
                      ? `<button class="btn small btn-uncomplete">되돌리기</button>`
                      : `<button class="btn small btn-complete">완료</button>`}
                    <button class="btn small danger btn-del">삭제</button>
                  </div>
                </td>
              </tr>
              <tr class="edit-row" data-edit-for="${esc(t.id)}" style="display:none"><td colspan="8"></td></tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("form-add-todo").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    addTodo(Object.fromEntries(fd.entries()));
    e.target.reset();
  };
  document.getElementById("f-search").oninput = (e) => { f.search = e.target.value; renderTodos(); };
  document.getElementById("f-status").onchange = (e) => { f.status = e.target.value; renderTodos(); };
  document.getElementById("f-priority").onchange = (e) => { f.priority = e.target.value; renderTodos(); };
  document.getElementById("f-tag").onchange = (e) => { f.tag = e.target.value; renderTodos(); };
  document.getElementById("f-sortkey").onchange = (e) => { f.sortKey = e.target.value; renderTodos(); };
  document.getElementById("f-sortdir").onchange = (e) => { f.sortDir = e.target.value; renderTodos(); };

  el.querySelectorAll(".btn-complete").forEach((b) => b.onclick = (e) => { b.disabled = true; toggleComplete(e.target.closest("tr").dataset.id); });
  el.querySelectorAll(".btn-uncomplete").forEach((b) => b.onclick = (e) => uncomplete(e.target.closest("tr").dataset.id));
  el.querySelectorAll(".btn-del").forEach((b) => b.onclick = (e) => deleteTodo(e.target.closest("tr").dataset.id));
  el.querySelectorAll(".btn-edit").forEach((b) => b.onclick = (e) => {
    const id = e.target.closest("tr").dataset.id;
    const todo = state.todos.find((t) => t.id === id);
    const editRow = el.querySelector(`tr.edit-row[data-edit-for="${CSS.escape(id)}"]`);
    const isOpen = editRow.style.display !== "none";
    el.querySelectorAll(".edit-row").forEach((r) => (r.style.display = "none"));
    if (isOpen) return;
    editRow.style.display = "";
    editRow.querySelector("td").innerHTML = `
      <form class="field-grid inline-edit">
        <div><label>할 일</label><input name="title" value="${esc(todo.title)}" required /></div>
        <div><label>마감일</label><input type="date" name="deadline" value="${esc(todo.deadline || "")}" /></div>
        <div><label>우선순위</label>
          <select name="priority">${["상", "중", "하"].map((v) => `<option value="${v}" ${todo.priority === v ? "selected" : ""}>${v}</option>`).join("")}</select>
        </div>
        <div><label>태그</label><input name="tag" value="${esc(todo.tag || "")}" /></div>
        <div><label>예상 시간(h)</label><input type="number" step="0.5" name="estimated_hours" value="${esc(todo.estimated_hours)}" /></div>
        <div style="grid-column:1/-1"><button type="submit" class="btn primary small">저장</button></div>
      </form>
    `;
    editRow.querySelector("form").onsubmit = (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const patch = Object.fromEntries(fd.entries());
      patch.estimated_hours = Number(patch.estimated_hours);
      updateTodo(id, patch);
    };
  });
}

function renderExecutions() {
  const el = document.getElementById("panel-exec");
  const activeTodos = state.todos;
  el.innerHTML = `
    <div class="card">
      <h3>실행 기록 추가</h3>
      <form id="form-add-exec" class="field-grid">
        <div style="grid-column:1/-1"><label>어느 할 일인가요</label>
          <select name="todo_id" required>
            ${activeTodos.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("")}
          </select>
        </div>
        <div><label>시작 시각</label><input type="datetime-local" name="start_at" /></div>
        <div><label>끝난 시각</label><input type="datetime-local" name="end_at" /></div>
        <div><label>실제 걸린 시간(h)</label><input type="number" step="0.5" name="actual_hours" required /></div>
        <div><label>막혔던 이유 (없으면 비워두세요)</label><input name="blocker_reason" /></div>
        <div style="grid-column:1/-1"><label>메모(선택)</label><input name="note" /></div>
        <div style="grid-column:1/-1"><button type="submit" class="btn primary">기록 추가 (계획 값은 바뀌지 않습니다)</button></div>
      </form>
    </div>
    <div class="card">
      <h3>기록 목록 (${state.executions.length}건)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>연결된 할 일</th><th>시작</th><th>끝</th><th>실제(h)</th><th>막힘</th><th>메모</th></tr></thead>
          <tbody>
            ${state.executions.length === 0 ? `<tr><td colspan="6" class="empty">아직 기록이 없습니다.</td></tr>` :
              state.executions.slice().sort((a,b)=> (a.start_at||"") < (b.start_at||"") ? -1 : 1).map((e) => {
                const t = state.todos.find((td) => td.id === e.todo_id);
                return `<tr>
                  <td>${esc(t ? t.title : e.todo_id)}</td>
                  <td>${esc(fmtDateTimeKST(e.start_at))}</td>
                  <td>${esc(fmtDateTimeKST(e.end_at))}</td>
                  <td>${esc(e.actual_hours)}</td>
                  <td>${e.blocker_reason ? esc(e.blocker_reason) : '<span class="muted">없음</span>'}</td>
                  <td class="wrap-text">${esc(e.note) || "-"}</td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById("form-add-exec").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    addExecution(Object.fromEntries(fd.entries()));
    e.target.reset();
  };
}

function todosMiniTable(items, emptyMsg) {
  if (items.length === 0) return `<div class="empty">${esc(emptyMsg)}</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>할 일</th><th>마감일</th><th>상태</th><th>우선순위</th></tr></thead>
        <tbody>
          ${items.map((t) => `<tr><td>${esc(t.title)}</td><td>${esc(fmtDateKST(t.deadline))}</td><td>${statusBadge(t.status)}</td><td>${priorityBadge(t.priority)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function execsMiniTable(targetIds) {
  const items = state.executions.filter((e) => targetIds.has(e.todo_id));
  if (items.length === 0) return `<div class="empty">해당 기간의 실행 기록이 없습니다.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>연결된 할 일</th><th>시작</th><th>실제(h)</th></tr></thead>
        <tbody>
          ${items.map((e) => {
            const t = state.todos.find((td) => td.id === e.todo_id);
            return `<tr><td>${esc(t ? t.title : e.todo_id)}</td><td>${esc(fmtDateTimeKST(e.start_at))}</td><td>${esc(e.actual_hours)}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderReview() {
  const el = document.getElementById("panel-review");
  const r = computeReview();
  const p = state.plan;

  let drillHtml = "";
  if (state.reviewDrill) {
    const d = state.reviewDrill;
    const titleMap = { plan: "이 기간의 할 일 전체", done: "완료된 할 일", delayed: "지연된 할 일", blocked: "막힌 이유가 있는 할 일", time: "실행 기록 (실제 시간 근거)" };
    drillHtml = `
      <div class="drilldown">
        <div class="row between"><h3>${esc(titleMap[d.kind])}</h3><button class="btn small" id="btn-close-drill">닫기</button></div>
        ${d.kind === "time" ? execsMiniTable(new Set(r.target.map((t) => t.id))) : todosMiniTable(d.items, "해당하는 항목이 없습니다.")}
      </div>`;
  }

  el.innerHTML = `
    <div class="card">
      <h3>기간</h3>
      <div class="row">
        <div><label>시작</label><input type="date" id="rp-start" value="${esc(state.reviewPeriod.start || "")}" /></div>
        <div><label>끝</label><input type="date" id="rp-end" value="${esc(state.reviewPeriod.end || "")}" /></div>
      </div>
      <div class="hint">마감일이 이 기간 안에 있는 할 일을 기준으로 집계합니다.</div>
    </div>

    <div class="kpi-grid">
      <button class="kpi" id="kpi-plan"><div class="num">${r.planCount}</div><div class="label">계획 수(할 일 수)</div></button>
      <button class="kpi" id="kpi-done"><div class="num">${r.doneItems.length}</div><div class="label">완료 수</div></button>
      <button class="kpi" id="kpi-delayed"><div class="num">${r.delayedItems.length}</div><div class="label">지연 수</div></button>
      <button class="kpi" id="kpi-blocked"><div class="num">${r.blockedItems.length}</div><div class="label">막힘 수</div></button>
      <button class="kpi" id="kpi-time">
        <div class="num">${r.estSum}h → ${r.actSum}h</div>
        <div class="label">예상 → 실제 (차이 <span class="${r.diff > 0 ? "" : ""}">${r.diff > 0 ? "+" : ""}${r.diff}h</span>)</div>
      </button>
    </div>

    ${drillHtml}

    <div class="card">
      <h3>다음 계획으로 넘길 한 줄</h3>
      <div class="row">
        <input id="carryover-input" style="flex:1" value="${esc(p?.carryover_note || "")}" placeholder="예: 리눅스마스터는 실기 위주로 시간을 더 배정하자" />
        <button class="btn primary" id="btn-save-carryover">저장</button>
      </div>
      ${p?.carryover_note ? `<div class="hint">현재 다음 계획 메모: ${esc(p.carryover_note)}</div>` : ""}
    </div>
  `;

  document.getElementById("rp-start").onchange = (e) => { state.reviewPeriod.start = e.target.value; state.reviewDrill = null; renderReview(); };
  document.getElementById("rp-end").onchange = (e) => { state.reviewPeriod.end = e.target.value; state.reviewDrill = null; renderReview(); };

  document.getElementById("kpi-plan").onclick = () => { state.reviewDrill = { kind: "plan", items: r.target }; renderReview(); };
  document.getElementById("kpi-done").onclick = () => { state.reviewDrill = { kind: "done", items: r.doneItems }; renderReview(); };
  document.getElementById("kpi-delayed").onclick = () => { state.reviewDrill = { kind: "delayed", items: r.delayedItems }; renderReview(); };
  document.getElementById("kpi-blocked").onclick = () => { state.reviewDrill = { kind: "blocked", items: r.blockedItems }; renderReview(); };
  document.getElementById("kpi-time").onclick = () => { state.reviewDrill = { kind: "time", items: [] }; renderReview(); };
  const closeBtn = document.getElementById("btn-close-drill");
  if (closeBtn) closeBtn.onclick = () => { state.reviewDrill = null; renderReview(); };

  document.getElementById("btn-save-carryover").onclick = () => {
    saveCarryover(document.getElementById("carryover-input").value.trim());
  };
}

function render() {
  renderPlan();
  renderTodos();
  renderExecutions();
  renderReview();
}

// ---------------------------------------------------------------
// Tabs + boot
// ---------------------------------------------------------------
function setupTabs() {
  document.querySelectorAll("nav.tabs button").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
    };
  });
}

async function boot() {
  setupTabs();
  document.getElementById("btn-export").onclick = exportAll;
  await loadAll();
  render();
}

boot();