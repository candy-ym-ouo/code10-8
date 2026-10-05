import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Button, Field, Select, SegmentedControl, Spinner, Tag, TextInput } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { RichTextEditor } from './RichTextEditor';
import { MediaStrip } from '../media/MediaStrip';
import { MediaUploader } from '../media/MediaUploader';
import { CATEGORY_LABELS, CATEGORY_ORDER, PERSON_ROLE_LABELS, PRECISION_HINTS, PRECISION_LABELS, VISIBILITY_LABELS } from '../../lib/constants';
import type { Category, ItemDetail, Media, Person, PersonRole, Precision, Visibility } from '../../api/types';
import { useFamily } from '../families/useFamily';

interface FormState {
  title: string;
  category: Category;
  acquiredPrecision: Precision;
  acquiredValue: string;
  acquiredLabel: string;
  acquiredNote: string;
  placeText: string;
  placeProvince: string;
  placeCity: string;
  storyHtml: string;
  tags: string;
  visibility: Visibility;
  condition: string;
  storageLocation: string;
  people: { personId: string; role: PersonRole }[];
}

const EMPTY: FormState = {
  title: '',
  category: 'furniture',
  acquiredPrecision: 'unknown',
  acquiredValue: '',
  acquiredLabel: '',
  acquiredNote: '',
  placeText: '',
  placeProvince: '',
  placeCity: '',
  storyHtml: '',
  tags: '',
  visibility: 'family',
  condition: '',
  storageLocation: '',
  people: [],
};

function toAcquiredAt(precision: Precision, value: string): string | null {
  if (!value) return null;
  if (precision === 'day') return new Date(`${value}T00:00:00.000Z`).toISOString();
  if (precision === 'month') return new Date(`${value}-01T00:00:00.000Z`).toISOString();
  if (precision === 'year') return new Date(`${value}-01-01T00:00:00.000Z`).toISOString();
  if (precision === 'decade') return new Date(`${value}-01-01T00:00:00.000Z`).toISOString();
  return null;
}

function fromItem(item: ItemDetail): FormState {
  const precision = item.acquiredPrecision;
  let value = '';
  if (item.acquiredAt) {
    const d = new Date(item.acquiredAt);
    if (precision === 'day') value = d.toISOString().slice(0, 10);
    else if (precision === 'month') value = d.toISOString().slice(0, 7);
    else if (precision === 'year') value = String(d.getUTCFullYear());
    else if (precision === 'decade') value = String(Math.floor(d.getUTCFullYear() / 10) * 10);
  }
  return {
    title: item.title,
    category: item.category,
    acquiredPrecision: precision,
    acquiredValue: value,
    acquiredLabel: item.acquiredLabel ?? '',
    acquiredNote: item.acquiredNote ?? '',
    placeText: item.placeText ?? '',
    placeProvince: item.placeProvince ?? '',
    placeCity: item.placeCity ?? '',
    storyHtml: item.storyHtml ?? '',
    tags: item.tags.join('、'),
    visibility: item.visibility,
    condition: item.condition ?? '',
    storageLocation: item.storageLocation ?? '',
    people: item.people.map((p) => ({ personId: p.personId, role: p.role })),
  };
}

export function ItemFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { fid, itemId } = useParams<{ fid: string; itemId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { data: familyData } = useFamily(fid);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState({ name: '', relation: '' });
  const [showNewPerson, setShowNewPerson] = useState(false);
  const [createdItemId, setCreatedItemId] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  const draftKey = fid ? `heirloom:draft:${itemId ?? 'new'}:${fid}` : '';

  const people = useQuery({
    queryKey: ['people', fid],
    queryFn: () => api.get<{ people: Person[] }>(`/families/${fid}/people`),
    enabled: Boolean(fid),
  });

  const detail = useQuery({
    queryKey: ['item', fid, itemId],
    queryFn: () => api.get<{ item: ItemDetail }>(`/families/${fid}/items/${itemId}`),
    enabled: mode === 'edit' && Boolean(itemId),
  });

  useEffect(() => {
    if (mode === 'edit' && detail.data) setForm(fromItem(detail.data.item));
  }, [mode, detail.data]);

  // 草稿保护：新建时中途切走/刷新不丢内容
  useEffect(() => {
    if (mode !== 'create' || !draftKey || draftRestored) return;
    const saved = localStorage.getItem(draftKey);
    if (saved) {
      try {
        setForm(JSON.parse(saved) as FormState);
        push('已恢复上次没写完的草稿', 'info');
      } catch {
        localStorage.removeItem(draftKey);
      }
    }
    setDraftRestored(true);
  }, [mode, draftKey, draftRestored, push]);

  useEffect(() => {
    if (mode !== 'create' || !draftKey || !draftRestored) return;
    const timer = window.setTimeout(() => localStorage.setItem(draftKey, JSON.stringify(form)), 800);
    return () => window.clearTimeout(timer);
  }, [form, mode, draftKey, draftRestored]);

  const create = useMutation({
    mutationFn: async () => {
      const payload = buildPayload(form);
      return api.post<{ item: ItemDetail }>(`/families/${fid}/items`, payload);
    },
    onSuccess: (data) => {
      if (draftKey) localStorage.removeItem(draftKey);
      push('条目已保存为草稿，可以继续上传照片和录音', 'success');
      setCreatedItemId(data.item.id);
      void queryClient.invalidateQueries({ queryKey: ['items', fid] });
      navigate(`/f/${fid}/items/${data.item.id}`, { replace: true });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存失败'),
  });

  const update = useMutation({
    mutationFn: async () => api.patch<{ item: ItemDetail }>(`/families/${fid}/items/${itemId}`, buildPayload(form)),
    onSuccess: async (data) => {
      push('已保存', 'success');
      await queryClient.invalidateQueries({ queryKey: ['item', fid, itemId] });
      await queryClient.invalidateQueries({ queryKey: ['items', fid] });
      navigate(`/f/${fid}/items/${data.item.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存失败'),
  });

  const addPerson = useMutation({
    mutationFn: () =>
      api.post<{ person: Person }>(`/families/${fid}/people`, {
        name: newPerson.name.trim(),
        relation: newPerson.relation.trim() || null,
      }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['people', fid] });
      setForm((prev) => ({ ...prev, people: [...prev.people, { personId: data.person.id, role: 'source' }] }));
      setNewPerson({ name: '', relation: '' });
      setShowNewPerson(false);
      push(`已加入人物「${data.person.name}」`, 'success');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '新建人物失败'),
  });

  const decades = useMemo(() => {
    const now = new Date().getFullYear();
    const list: number[] = [];
    for (let y = Math.floor(now / 10) * 10; y >= 1900; y -= 10) list.push(y);
    return list;
  }, []);

  if (mode === 'edit' && detail.isLoading) return <Spinner label="正在读取条目…" />;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const busy = create.isPending || update.isPending;
  const media: Media[] = detail.data?.item.media ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{mode === 'create' ? '记一件物品' : '编辑条目'}</h1>
          <p className="page-head__sub">
            记得多少就写多少，拿不准的时间可以直接写「我上小学那年」。
          </p>
        </div>
        <div className="page-head__actions">
          <Button onClick={() => navigate(-1)}>取消</Button>
          <Button variant="primary" loading={busy} onClick={() => {
            setError(null);
            if (!form.title.trim()) {
              setError('请先给这件物品起个名字');
              return;
            }
            if (mode === 'create') create.mutate();
            else update.mutate();
          }}>
            保存
          </Button>
        </div>
      </div>

      {error ? (
        <div className="card" role="alert" style={{ borderColor: 'var(--accent)', marginBottom: 'var(--space-4)' }}>
          <span className="field__error">{error}</span>
        </div>
      ) : null}

      <div className="stack">
        <section className="card">
          <h2 style={{ marginBottom: 'var(--space-4)' }}>基本信息</h2>
          <Field label="名称" required hint="例如「外公的樟木箱」">
            <TextInput value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
          </Field>
          <Field label="类别" required group>
            <SegmentedControl
              name="类别"
              value={form.category}
              onChange={(v) => set('category', v)}
              options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
            />
          </Field>
          <div className="form-grid">
            <Field label="保存状况" hint="例如「箱体完好，锁扣缺失」">
              <TextInput value={form.condition} onChange={(e) => set('condition', e.target.value)} maxLength={200} />
            </Field>
            <Field label="现在放在哪" hint="例如「老二家储藏间」">
              <TextInput value={form.storageLocation} onChange={(e) => set('storageLocation', e.target.value)} maxLength={120} />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 'var(--space-4)' }}>获得时间</h2>
          <Field label="能记到什么程度" required group>
            <SegmentedControl
              name="时间精度"
              value={form.acquiredPrecision}
              onChange={(v) => set('acquiredPrecision', v)}
              options={(Object.keys(PRECISION_LABELS) as Precision[]).map((p) => ({
                value: p,
                label: PRECISION_LABELS[p],
              }))}
            />
          </Field>
          <p className="field__hint" style={{ marginTop: '-8px', marginBottom: 'var(--space-3)' }}>
            {PRECISION_HINTS[form.acquiredPrecision]}
          </p>

          <div className="form-grid">
            {form.acquiredPrecision === 'day' ? (
              <Field label="具体日期">
                <TextInput type="date" value={form.acquiredValue} onChange={(e) => set('acquiredValue', e.target.value)} />
              </Field>
            ) : null}
            {form.acquiredPrecision === 'month' ? (
              <Field label="年月">
                <TextInput type="month" value={form.acquiredValue} onChange={(e) => set('acquiredValue', e.target.value)} />
              </Field>
            ) : null}
            {form.acquiredPrecision === 'year' ? (
              <Field label="年份">
                <TextInput
                  type="number"
                  min={1800}
                  max={2200}
                  placeholder="1978"
                  value={form.acquiredValue}
                  onChange={(e) => set('acquiredValue', e.target.value)}
                />
              </Field>
            ) : null}
            {form.acquiredPrecision === 'decade' ? (
              <Field label="年代">
                <Select value={form.acquiredValue} onChange={(e) => set('acquiredValue', e.target.value)}>
                  <option value="">请选择</option>
                  {decades.map((d) => (
                    <option key={d} value={d}>
                      {d} 年代
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="用自己的话说" hint="会和时间一起显示，例如「我上小学那年」">
              <TextInput value={form.acquiredLabel} onChange={(e) => set('acquiredLabel', e.target.value)} maxLength={64} />
            </Field>
          </div>
          <Field label="这个时间是怎么知道的" hint="选填，例如「按户口本迁移时间推算」">
            <TextInput value={form.acquiredNote} onChange={(e) => set('acquiredNote', e.target.value)} maxLength={200} />
          </Field>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 'var(--space-4)' }}>地点</h2>
          <Field label="拿到这件东西的地方" hint="可以直接写「老家堂屋」">
            <TextInput value={form.placeText} onChange={(e) => set('placeText', e.target.value)} maxLength={255} />
          </Field>
          <div className="form-grid">
            <Field label="省 / 直辖市">
              <TextInput value={form.placeProvince} onChange={(e) => set('placeProvince', e.target.value)} maxLength={64} />
            </Field>
            <Field label="市 / 县">
              <TextInput value={form.placeCity} onChange={(e) => set('placeCity', e.target.value)} maxLength={64} />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 'var(--space-4)' }}>来源人物</h2>
          {people.data?.people.length ? (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              {people.data.people.map((p) => {
                const selected = form.people.find((x) => x.personId === p.id);
                return (
                  <div key={p.id} className="row" style={{ marginBottom: 6, gap: 'var(--space-2)' }}>
                    <label className="row" style={{ gap: 6, minWidth: 160, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(selected)}
                        onChange={(e) => {
                          set(
                            'people',
                            e.target.checked
                              ? [...form.people, { personId: p.id, role: 'source' }]
                              : form.people.filter((x) => x.personId !== p.id),
                          );
                        }}
                      />
                      <span>
                        {p.name}
                        {p.relation ? <span className="muted">（{p.relation}）</span> : null}
                      </span>
                    </label>
                    {selected ? (
                      <Select
                        aria-label={`${p.name} 的关联方式`}
                        style={{ maxWidth: 160 }}
                        value={selected.role}
                        onChange={(e) =>
                          set(
                            'people',
                            form.people.map((x) => (x.personId === p.id ? { ...x, role: e.target.value as PersonRole } : x)),
                          )
                        }
                      >
                        {(Object.keys(PERSON_ROLE_LABELS) as PersonRole[]).map((r) => (
                          <option key={r} value={r}>
                            {PERSON_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">还没有人物档案。可以先在这件物品上写清楚是谁给的。</p>
          )}

          {showNewPerson ? (
            <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'flex-end' }}>
              <Field label="称呼" required>
                <TextInput value={newPerson.name} onChange={(e) => setNewPerson((p) => ({ ...p, name: e.target.value }))} />
              </Field>
              <Field label="关系" hint="例如「外公」">
                <TextInput value={newPerson.relation} onChange={(e) => setNewPerson((p) => ({ ...p, relation: e.target.value }))} />
              </Field>
              <Button
                variant="primary"
                loading={addPerson.isPending}
                disabled={!newPerson.name.trim()}
                onClick={() => addPerson.mutate()}
                style={{ marginBottom: 'var(--space-4)' }}
              >
                添加
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setShowNewPerson(true)}>
              + 新建人物
            </Button>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 'var(--space-4)' }}>背后的故事</h2>
          <RichTextEditor
            value={form.storyHtml}
            onChange={(html) => set('storyHtml', html)}
            placeholder="这件东西是怎么来的？当时发生了什么？谁经常提起它？"
          />
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 'var(--space-4)' }}>标签与可见范围</h2>
          <Field label="标签" hint="用顿号或逗号分隔，例如「樟木、手工」">
            <TextInput value={form.tags} onChange={(e) => set('tags', e.target.value)} />
          </Field>
          <Field label="谁能看到" required group>
            <SegmentedControl
              name="可见范围"
              value={form.visibility}
              onChange={(v) => set('visibility', v)}
              options={(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => ({
                value: v,
                label: VISIBILITY_LABELS[v],
              }))}
            />
          </Field>
        </section>

        {mode === 'edit' && itemId ? (
          <section className="card">
            <h2 style={{ marginBottom: 'var(--space-4)' }}>照片与录音</h2>
            <MediaStrip fid={fid!} media={media} editable onChange={() => void queryClient.invalidateQueries({ queryKey: ['item', fid, itemId] })} />
            <hr className="divider" />
            <MediaUploader
              fid={fid!}
              itemId={itemId}
              onUploaded={() => {
                void queryClient.invalidateQueries({ queryKey: ['item', fid, itemId] });
                void queryClient.invalidateQueries({ queryKey: ['items', fid] });
              }}
            />
          </section>
        ) : (
          <section className="card">
            <h2 style={{ marginBottom: 'var(--space-2)' }}>照片与录音</h2>
            <p className="muted" style={{ marginBottom: 0 }}>
              先保存这条记录，然后在详情页上传照片、录音或扫描件（也可以直接在手机上录音）。
            </p>
            {createdItemId ? <Tag tone="success">已保存，可以直接上传</Tag> : null}
          </section>
        )}

        <div className="row row--between">
          <span className="muted">
            {familyData?.family.name} · {mode === 'create' ? '新建条目' : '编辑条目'}
          </span>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              setError(null);
              if (!form.title.trim()) {
                setError('请先给这件物品起个名字');
                return;
              }
              if (mode === 'create') create.mutate();
              else update.mutate();
            }}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}

function buildPayload(form: FormState) {
  return {
    title: form.title.trim(),
    category: form.category,
    acquiredPrecision: form.acquiredPrecision,
    acquiredAt: toAcquiredAt(form.acquiredPrecision, form.acquiredValue),
    acquiredLabel: form.acquiredLabel.trim() || null,
    acquiredNote: form.acquiredNote.trim() || null,
    placeText: form.placeText.trim() || null,
    placeProvince: form.placeProvince.trim() || null,
    placeCity: form.placeCity.trim() || null,
    storyHtml: form.storyHtml || null,
    condition: form.condition.trim() || null,
    storageLocation: form.storageLocation.trim() || null,
    tags: form.tags
      .split(/[、,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20),
    visibility: form.visibility,
    people: form.people,
  };
}
