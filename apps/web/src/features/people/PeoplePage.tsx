import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Button, EmptyState, Field, Modal, Spinner, TextArea, TextInput } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useFamily } from '../families/useFamily';
import type { Person } from '../../api/types';

export function PeoplePage() {
  const { fid } = useParams<{ fid: string }>();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { data: familyData } = useFamily(fid);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', relation: '', birthYear: '', deathYear: '', bio: '' });
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['people', fid, q],
    queryFn: () => api.get<{ people: Person[] }>(`/families/${fid}/people${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    enabled: Boolean(fid),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post(`/families/${fid}/people`, {
        name: form.name.trim(),
        relation: form.relation.trim() || null,
        birthYear: form.birthYear ? Number(form.birthYear) : null,
        deathYear: form.deathYear ? Number(form.deathYear) : null,
        bio: form.bio.trim() || null,
      }),
    onSuccess: async () => {
      push('人物已建立', 'success');
      setOpen(false);
      setForm({ name: '', relation: '', birthYear: '', deathYear: '', bio: '' });
      await queryClient.invalidateQueries({ queryKey: ['people', fid] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存失败'),
  });

  const canWrite = familyData && ['owner', 'admin', 'editor'].includes(familyData.myRole);
  const people = query.data?.people ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>人物</h1>
          <p className="page-head__sub">把「这东西是谁给的」记成人物档案，以后能反查一个人送过、留下的所有东西。</p>
        </div>
        {canWrite ? (
          <Button variant="primary" onClick={() => setOpen(true)}>
            新建人物
          </Button>
        ) : null}
      </div>

      <div className="filters">
        <div className="field search-input">
          <label className="field__label" htmlFor="people-search">
            搜索人物
          </label>
          <TextInput
            id="people-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="输入称呼或关系"
          />
        </div>
      </div>

      {query.isLoading ? (
        <Spinner />
      ) : people.length === 0 ? (
        <EmptyState
          icon="👵"
          title="还没有人物档案"
          description="建立人物后，在记录物品时就能直接选「是谁给的」。"
          action={canWrite ? <Button variant="primary" onClick={() => setOpen(true)}>新建第一个人物</Button> : undefined}
        />
      ) : (
        <div className="grid-cards">
          {people.map((p) => (
            <Link key={p.id} to={`/f/${fid}/people/${p.id}`} className="item-card" style={{ padding: 'var(--space-4)' }}>
              <h2>{p.name}</h2>
              <div className="item-card__meta">
                {p.relation ? <span>{p.relation}</span> : null}
                {p.birthYear ? <span>· {p.birthYear}{p.deathYear ? `–${p.deathYear}` : ''}</span> : null}
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: 'var(--space-2)', marginBottom: 0 }}>
                关联 {p.itemCount} 件物品
              </p>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={open}
        title="新建人物"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={!form.name.trim()}
              onClick={() => {
                setError(null);
                create.mutate();
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <Field label="称呼" required hint="例如「外公」「王阿姨」">
          <TextInput value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} autoFocus />
        </Field>
        <Field label="关系" hint="例如「外公」「老同事」">
          <TextInput value={form.relation} onChange={(e) => setForm((p) => ({ ...p, relation: e.target.value }))} />
        </Field>
        <div className="form-grid">
          <Field label="出生年份">
            <TextInput
              type="number"
              value={form.birthYear}
              onChange={(e) => setForm((p) => ({ ...p, birthYear: e.target.value }))}
            />
          </Field>
          <Field label="去世年份">
            <TextInput
              type="number"
              value={form.deathYear}
              onChange={(e) => setForm((p) => ({ ...p, deathYear: e.target.value }))}
            />
          </Field>
        </div>
        <Field label="小传" hint="选填，几句话就行">
          <TextArea value={form.bio} onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))} maxLength={2000} />
        </Field>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}

