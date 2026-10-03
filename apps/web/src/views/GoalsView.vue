<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { apiFetch, ApiError } from "../api/client.js";
import EmptyState from "../components/EmptyState.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import StatusBadge from "../components/StatusBadge.vue";
import {
  goalStatusLabels,
  metricDirectionLabels,
  progressTrendClass,
  progressTrendLabels,
} from "../utils/format.js";

interface MediaOption { id: string; originalName: string; status: string }
interface Goal {
  id: string; title: string; category: string; metricType: string; metricDirection: "HIGHER_BETTER" | "LOWER_BETTER";
  baselineValue: number | null; targetValue: number; unit: string; dueDate: string;
  method: string | null; evidenceRequirement: string; status: string; version: number; revisionReason: string | null;
  sourceSession: { id: string; title: string; instrument: string; startedAt: string };
  annotation: { id: string; title: string; type: string } | null;
  progresses: Array<{
    id: string; actualValue: number; trend: "UP" | "DOWN" | "FLAT" | null; note: string | null; recordedAt: string;
    session: { id: string; title: string };
    evidenceMedia: { id: string; originalName: string; status: string } | null;
  }>;
}
interface SessionOption {
  id: string; title: string; instrument: string; status: string;
  mediaAssets?: MediaOption[];
}

const goals = ref<Goal[]>([]);
const sessions = ref<SessionOption[]>([]);
const sessionMedia = reactive<Record<string, MediaOption[]>>({});
const status = ref("");
const loading = ref(true);
const error = ref("");
const creating = ref(false);
const progressSession = reactive<Record<string, string>>({});
const progressValue = reactive<Record<string, string>>({});
const progressNote = reactive<Record<string, string>>({});
const progressEvidence = reactive<Record<string, string>>({});
const form = reactive({
  sourceSessionId: "", title: "", category: "RHYTHM", metricType: "SPEED", metricDirection: "HIGHER_BETTER",
  baselineValue: "", targetValue: "", unit: "BPM",
  dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), method: "", evidenceRequirement: "NONE", annotationId: "",
});

function readyMediaFor(sessionId: string): MediaOption[] {
  return (sessionMedia[sessionId] ?? []).filter((media) => media.status === "READY");
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const query = status.value ? `?status=${status.value}&limit=100` : "?limit=100";
    const [goalResult, sessionResult] = await Promise.all([
      apiFetch<{ data: Goal[] }>(`/api/v1/goals${query}`),
      apiFetch<{ data: SessionOption[] }>("/api/v1/sessions?status=ALL&limit=100&sortBy=updatedAt&sortOrder=desc"),
    ]);
    goals.value = goalResult.data;
    sessions.value = sessionResult.data;
    if (!form.sourceSessionId && sessions.value[0]) form.sourceSessionId = sessions.value[0].id;
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "目标加载失败";
  } finally {
    loading.value = false;
  }
}
async function ensureMedia(sessionId: string | undefined): Promise<void> {
  if (!sessionId || sessionMedia[sessionId]) return;
  try {
    const detail = await apiFetch<{ session: SessionOption }>(`/api/v1/sessions/${sessionId}`);
    sessionMedia[sessionId] = detail.session.mediaAssets ?? [];
  } catch {
    sessionMedia[sessionId] = [];
  }
}
async function createGoal(): Promise<void> {
  const annotationId = form.annotationId || null;
  await apiFetch("/api/v1/goals", {
    method: "POST",
    body: JSON.stringify({
      sourceSessionId: form.sourceSessionId,
      annotationId,
      title: form.title,
      category: form.category,
      metricType: form.metricType,
      metricDirection: form.metricDirection,
      baselineValue: form.baselineValue === "" ? null : Number(form.baselineValue),
      targetValue: Number(form.targetValue),
      unit: form.unit,
      dueDate: new Date(`${form.dueDate}T12:00:00.000Z`).toISOString(),
      method: form.method || null,
      evidenceRequirement: form.evidenceRequirement,
    }),
  });
  creating.value = false;
  form.title = "";
  form.targetValue = "";
  await load();
}
async function recordProgress(goal: Goal): Promise<void> {
  const sessionId = progressSession[goal.id] || goal.sourceSession.id;
  const actualValue = Number(progressValue[goal.id]);
  if (!Number.isFinite(actualValue)) return;
  // 目标要求音频证据时，重复记录也必须各自携带证据；历史记录不会被覆盖。
  if (
    (goal.evidenceRequirement === "AUDIO" || goal.evidenceRequirement === "AUDIO_AND_SELF_REVIEW") &&
    !progressEvidence[goal.id]
  ) {
    error.value = "该目标要求音频证据，请选择证据音频";
    return;
  }
  if (
    (goal.evidenceRequirement === "SELF_REVIEW" || goal.evidenceRequirement === "AUDIO_AND_SELF_REVIEW") &&
    !progressNote[goal.id]?.trim()
  ) {
    error.value = "该目标要求自评说明，请填写进度备注";
    return;
  }
  try {
    await apiFetch(`/api/v1/goals/${goal.id}/progress`, {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        actualValue,
        note: progressNote[goal.id] || null,
        evidenceMediaId: progressEvidence[goal.id] || null,
      }),
    });
    progressValue[goal.id] = "";
    progressNote[goal.id] = "";
    progressEvidence[goal.id] = "";
    error.value = "";
    await load();
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "进度记录失败";
  }
}
async function completeGoal(goal: Goal): Promise<void> {
  if (!window.confirm(`确认目标“${goal.title}”已经达成？需要存在按指标方向达到目标值的进度记录。`)) return;
  try {
    await apiFetch(`/api/v1/goals/${goal.id}/complete`, { method: "POST", body: "{}" });
    error.value = "";
    await load();
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "确认达成失败";
  }
}
async function cancelGoal(goal: Goal): Promise<void> {
  const reason = window.prompt("请输入取消目标的原因：");
  if (!reason) return;
  await apiFetch(`/api/v1/goals/${goal.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
  await load();
}
async function activateGoal(goal: Goal): Promise<void> {
  const revisionReason = window.prompt("重新激活会修订目标，请输入修订原因（必填）：");
  if (!revisionReason?.trim()) return;
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await apiFetch(`/api/v1/goals/${goal.id}/activate`, {
    method: "POST",
    body: JSON.stringify({ dueDate: due, revisionReason }),
  });
  await load();
}
onMounted(load);
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div><h1>目标中心</h1><p>把问题转化为可判断完成的目标，并保留每一次进度证据。</p></div>
      <button class="button" :disabled="!sessions.length" @click="creating = !creating">新增目标</button>
    </header>
    <div class="tabs" style="margin-bottom: 18px">
      <button class="tab" :class="{ active: status === '' }" @click="status = ''; load()">全部</button>
      <button v-for="item in ['OPEN', 'IN_PROGRESS', 'ACHIEVED', 'MISSED', 'CANCELLED']" :key="item" class="tab" :class="{ active: status === item }" @click="status = item; load()">{{ goalStatusLabels[item as keyof typeof goalStatusLabels] }}</button>
    </div>

    <form v-if="creating" class="card form-grid" style="margin-bottom: 18px" @submit.prevent="createGoal">
      <label class="field full"><span>来源练习</span><select v-model="form.sourceSessionId" required><option v-for="session in sessions" :key="session.id" :value="session.id">{{ session.instrument }} · {{ session.title }}</option></select></label>
      <label class="field full"><span>可执行目标标题</span><input v-model="form.title" required maxlength="160" placeholder="包含具体片段、动作和数值" /></label>
      <label class="field"><span>分类</span><select v-model="form.category"><option value="RHYTHM">节奏</option><option value="FINGERING">指法</option><option value="EMOTION">情绪</option><option value="CONTINUITY">连贯性</option><option value="PITCH">音准</option><option value="SPEED">速度</option><option value="REPERTOIRE">曲目完成度</option><option value="OTHER">其他</option></select></label>
      <label class="field"><span>指标类型</span><select v-model="form.metricType"><option value="DURATION">时长</option><option value="COUNT">次数</option><option value="SPEED">速度</option><option value="ACCURACY">正确率</option><option value="SUBJECTIVE_SCORE">主观评分</option><option value="CUSTOM">自定义</option></select></label>
      <label class="field"><span>指标方向</span><select v-model="form.metricDirection"><option value="HIGHER_BETTER">越高越好（速度、正确率）</option><option value="LOWER_BETTER">越低越好（错误数、耗时）</option></select></label>
      <label class="field"><span>基线值</span><input v-model="form.baselineValue" type="number" step="any" /></label>
      <label class="field"><span>目标值</span><input v-model="form.targetValue" required type="number" step="any" /></label>
      <label class="field"><span>单位</span><input v-model="form.unit" required maxlength="24" /></label>
      <label class="field"><span>截止日期</span><input v-model="form.dueDate" required type="date" /></label>
      <label class="field"><span>证据要求</span><select v-model="form.evidenceRequirement"><option value="NONE">无</option><option value="AUDIO">音频</option><option value="SELF_REVIEW">自评</option><option value="AUDIO_AND_SELF_REVIEW">音频与自评</option></select></label>
      <label class="field full"><span>练习方法</span><textarea v-model="form.method" maxlength="3000" /></label>
      <div class="row end full"><button class="button ghost" type="button" @click="creating = false">取消</button><button class="button" type="submit">创建目标</button></div>
    </form>

    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="alert">{{ error }} <button class="button small ghost" @click="load">重试</button></div>
    <EmptyState v-else-if="!goals.length" title="没有符合条件的目标" description="从练习详情或复盘总结中创建目标，下一次练习就能直接接手。" action-label="新建练习" @action="$router.push('/sessions/new')" />
    <div v-else class="goals-grid">
      <article v-for="goal in goals" :key="goal.id" class="card stack">
        <div class="row between"><StatusBadge :value="goal.status" kind="goal" /><small>截止 {{ goal.dueDate.slice(0, 10) }}</small></div>
        <div><h2>{{ goal.title }}</h2><p class="muted">{{ goal.sourceSession.instrument }} · 来源：{{ goal.sourceSession.title }}</p></div>
        <div class="metric-line"><strong>{{ goal.targetValue }} {{ goal.unit }}</strong><span v-if="goal.baselineValue != null">基线 {{ goal.baselineValue }} {{ goal.unit }}</span><span>{{ metricDirectionLabels[goal.metricDirection] }}</span></div>
        <p v-if="goal.method" class="muted">{{ goal.method }}</p>
        <p v-if="goal.revisionReason" class="revision-reason">最近修订：{{ goal.revisionReason }}</p>
        <div v-if="goal.progresses.length" class="progress-history">
          <strong>最近进度</strong>
          <div v-for="progress in goal.progresses.slice(0, 3)" :key="progress.id">
            <span>{{ progress.actualValue }} {{ goal.unit }}<em v-if="progress.trend" class="trend" :class="progressTrendClass(progress.trend)">{{ progressTrendLabels[progress.trend] }}</em></span>
            <small>{{ progress.recordedAt.slice(0, 10) }} · {{ progress.session.title }}<template v-if="progress.evidenceMedia"> · 🎧 {{ progress.evidenceMedia.originalName }}</template></small>
          </div>
        </div>
        <div v-if="!['ACHIEVED', 'CANCELLED'].includes(goal.status)" class="progress-form">
          <select v-model="progressSession[goal.id]" @change="ensureMedia(progressSession[goal.id])"><option value="">选择本次练习</option><option v-for="session in sessions" :key="session.id" :value="session.id">{{ session.title }}</option></select>
          <input v-model="progressValue[goal.id]" type="number" step="any" placeholder="实际值" />
          <input v-model="progressNote[goal.id]" placeholder="备注/自评" />
          <select v-if="goal.evidenceRequirement !== 'NONE'" v-model="progressEvidence[goal.id]" :required="goal.evidenceRequirement === 'AUDIO' || goal.evidenceRequirement === 'AUDIO_AND_SELF_REVIEW'" @focus="ensureMedia(progressSession[goal.id] || goal.sourceSession.id)">
            <option value="">证据音频</option>
            <option v-for="media in readyMediaFor(progressSession[goal.id] || goal.sourceSession.id)" :key="media.id" :value="media.id">{{ media.originalName }}</option>
          </select>
          <button class="button small secondary" @click="recordProgress(goal)">记录进度</button>
        </div>
        <div class="row end">
          <button v-if="['MISSED', 'CANCELLED'].includes(goal.status)" class="button small secondary" @click="activateGoal(goal)">重新激活</button>
          <button v-if="!['ACHIEVED', 'CANCELLED'].includes(goal.status)" class="button small" @click="completeGoal(goal)">确认达成</button>
          <button v-if="!['ACHIEVED', 'CANCELLED'].includes(goal.status)" class="button small ghost" @click="cancelGoal(goal)">取消</button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.goals-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px; }
.metric-line { display: flex; align-items: baseline; gap: 12px; }
.metric-line strong { font-size: 1.6rem; }
.metric-line span { color: var(--muted); }
.progress-history { display: grid; gap: 7px; padding: 12px; border-radius: 10px; background: var(--surface-soft); }
.progress-history div { display: flex; justify-content: space-between; gap: 10px; }
.progress-history .trend { font-style: normal; font-size: 0.85em; margin-left: 6px; }
.trend-up { color: var(--primary); }
.trend-down { color: var(--danger); }
.trend-flat { color: var(--muted); }
.revision-reason { font-size: 0.9em; color: var(--warning); }
.progress-form { display: grid; grid-template-columns: 1fr 100px 1fr auto; gap: 8px; }
@media (max-width: 900px) { .goals-grid { grid-template-columns: 1fr; } .progress-form { grid-template-columns: 1fr; } }
</style>
