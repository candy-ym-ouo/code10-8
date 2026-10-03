<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { apiFetch, ApiError } from "../api/client.js";
import EmptyState from "../components/EmptyState.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { goalStatusLabels, metricDirectionLabels, progressTrendLabels } from "../utils/format.js";

interface Goal {
  id: string; title: string; category: string; metricType: string; metricDirection: "UP" | "DOWN"; baselineValue: number | null; targetValue: number; unit: string; dueDate: string;
  method: string | null; evidenceRequirement: string; status: string; version: number;
  sourceSession: { id: string; title: string; instrument: string; startedAt: string };
  annotation: { id: string; title: string; type: string } | null;
  progresses: Array<{
    id: string; actualValue: number; note: string | null; revisionReason: string | null; recordedAt: string;
    session: { id: string; title: string };
    evidenceMedia: { id: string; originalName: string; status: string } | null;
  }>;
}
interface SessionOption {
  id: string; title: string; instrument: string; status: string;
  mediaAssets: Array<{ id: string; originalName: string; status: string }>;
}

const goals = ref<Goal[]>([]);
const sessions = ref<SessionOption[]>([]);
const status = ref("");
const loading = ref(true);
const error = ref("");
const creating = ref(false);
const progressSession = reactive<Record<string, string>>({});
const progressValue = reactive<Record<string, string>>({});
const progressNote = reactive<Record<string, string>>({});
const progressMedia = reactive<Record<string, string>>({});
const progressRevision = reactive<Record<string, string>>({});
const sessionMedia = reactive<Record<string, SessionOption["mediaAssets"]>>({});
const form = reactive({
  sourceSessionId: "", title: "", category: "RHYTHM", metricType: "SPEED", metricDirection: "UP", baselineValue: "", targetValue: "", unit: "BPM",
  dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), method: "", evidenceRequirement: "NONE", annotationId: "",
});

async function ensureMedia(sessionId: string): Promise<void> {
  if (sessionMedia[sessionId]) return;
  const result = await apiFetch<{ session: { mediaAssets: SessionOption["mediaAssets"] } }>(`/api/v1/sessions/${sessionId}`);
  sessionMedia[sessionId] = result.session.mediaAssets;
}

function readyMediaFor(goal: Goal): SessionOption["mediaAssets"] {
  const sessionId = progressSession[goal.id] || goal.sourceSession.id;
  void ensureMedia(sessionId);
  return (sessionMedia[sessionId] ?? []).filter((media) => media.status === "READY");
}

function trendFor(goal: Goal, index: number): "" | "IMPROVING" | "FLAT" | "REGRESSING" {
  const older = goal.progresses[index + 1];
  if (!older) return "";
  const delta = Number(goal.progresses[index]!.actualValue) - Number(older.actualValue);
  const directed = goal.metricDirection === "DOWN" ? -delta : delta;
  return directed > 0 ? "IMPROVING" : directed < 0 ? "REGRESSING" : "FLAT";
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
  await apiFetch(`/api/v1/goals/${goal.id}/progress`, {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      actualValue,
      note: progressNote[goal.id] || null,
      evidenceMediaId: progressMedia[goal.id] || null,
      revisionReason: progressRevision[goal.id] || null,
    }),
  });
  progressValue[goal.id] = "";
  progressNote[goal.id] = "";
  progressMedia[goal.id] = "";
  progressRevision[goal.id] = "";
  await load();
}
async function completeGoal(goal: Goal): Promise<void> {
  if (!window.confirm(`确认目标“${goal.title}”已经达成？`)) return;
  let revisionReason: string | null = null;
  const latest = goal.progresses[0];
  const reached = latest
    ? goal.metricDirection === "DOWN"
      ? Number(latest.actualValue) <= Number(goal.targetValue)
      : Number(latest.actualValue) >= Number(goal.targetValue)
    : false;
  if (!reached) {
    revisionReason = window.prompt("最近一次测量尚未达到目标值，请填写修订或豁免原因：");
    if (!revisionReason) return;
  }
  await apiFetch(`/api/v1/goals/${goal.id}/complete`, {
    method: "POST",
    body: JSON.stringify({ revisionReason }),
  });
  await load();
}
async function cancelGoal(goal: Goal): Promise<void> {
  const reason = window.prompt("请输入取消目标的原因：");
  if (!reason) return;
  await apiFetch(`/api/v1/goals/${goal.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
  await load();
}
async function activateGoal(goal: Goal): Promise<void> {
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await apiFetch(`/api/v1/goals/${goal.id}/activate`, { method: "POST", body: JSON.stringify({ dueDate: due }) });
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
      <label class="field"><span>指标方向</span><select v-model="form.metricDirection"><option value="UP">{{ metricDirectionLabels.UP }}</option><option value="DOWN">{{ metricDirectionLabels.DOWN }}</option></select></label>
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
        <div class="metric-line"><strong>{{ goal.targetValue }} {{ goal.unit }}</strong><span v-if="goal.baselineValue != null">基线 {{ goal.baselineValue }} {{ goal.unit }}</span><small>{{ metricDirectionLabels[goal.metricDirection] }}</small></div>
        <p v-if="goal.method" class="muted">{{ goal.method }}</p>
        <div v-if="goal.progresses.length" class="progress-history">
          <strong>最近进度</strong>
          <div v-for="(progress, index) in goal.progresses.slice(0, 5)" :key="progress.id">
            <span>
              {{ progress.actualValue }} {{ goal.unit }}
              <small v-if="trendFor(goal, index)" class="trend" :class="trendFor(goal, index)">{{ progressTrendLabels[trendFor(goal, index) as "IMPROVING"] }}</small>
            </span>
            <small>{{ progress.recordedAt.slice(0, 10) }} · {{ progress.session.title }}</small>
          </div>
          <small v-if="goal.progresses[0]?.evidenceMedia" class="muted">证据音频：{{ goal.progresses[0].evidenceMedia.originalName }}</small>
          <small v-for="progress in goal.progresses.filter((item) => item.revisionReason).slice(0, 2)" :key="`${progress.id}-rev`" class="muted">修订原因：{{ progress.revisionReason }}</small>
        </div>
        <div v-if="!['ACHIEVED', 'CANCELLED'].includes(goal.status)" class="progress-form">
          <select v-model="progressSession[goal.id]"><option value="">选择本次练习</option><option v-for="session in sessions" :key="session.id" :value="session.id">{{ session.title }}</option></select>
          <input v-model="progressValue[goal.id]" type="number" step="any" placeholder="实际值" />
          <select v-if="goal.evidenceRequirement !== 'NONE'" v-model="progressMedia[goal.id]">
            <option value="">选择证据音频</option>
            <option v-for="media in readyMediaFor(goal)" :key="media.id" :value="media.id">{{ media.originalName }}</option>
          </select>
          <input v-model="progressNote[goal.id]" placeholder="备注/自评" />
          <input v-model="progressRevision[goal.id]" placeholder="修订原因（重复记录时必填）" />
          <button class="button small secondary" @click="recordProgress(goal)">记录进度</button>
          <small v-if="goal.evidenceRequirement !== 'NONE'" class="muted hint">证据要求：{{ goal.evidenceRequirement === 'AUDIO' ? '音频' : goal.evidenceRequirement === 'SELF_REVIEW' ? '自评' : '音频与自评' }}</small>
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
.trend { margin-left: 6px; padding: 1px 6px; border-radius: 6px; }
.trend.IMPROVING { color: #176c4b; background: #dff3e7; }
.trend.REGRESSING { color: #9a2b25; background: #f8e1de; }
.trend.FLAT { color: #66706c; background: #ecefec; }
.hint { grid-column: 1 / -1; }
.progress-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; align-items: center; }
@media (max-width: 900px) { .goals-grid { grid-template-columns: 1fr; } .progress-form { grid-template-columns: 1fr; } }
</style>
