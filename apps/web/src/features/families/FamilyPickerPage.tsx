import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, EmptyState, Field, Modal, TextInput } from '../../components/ui';
import { ROLE_LABELS } from '../../lib/constants';
import { useToast } from '../../components/Toast';
import type { FamilyDetail } from '../../api/types';

export function FamilyPickerPage() {
  const { user, memberships, reloadMemberships } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ family: FamilyDetail }>('/families', { name: name.trim(), description: description.trim() || null }),
    onSuccess: async (data) => {
      await reloadMemberships();
      await queryClient.invalidateQueries({ queryKey: ['family', data.family.id] });
      push('家庭空间已创建', 'success');
      setOpen(false);
      navigate(`/f/${data.family.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '创建失败'),
  });

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <span className="brand">
            <span className="brand__mark" aria-hidden="true">
              册
            </span>
            <span>家中物品来历册</span>
          </span>
          <div style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: 14 }}>
            {user?.displayName}
          </span>
        </div>
      </header>
      <main className="app-main">
        <div className="page-head">
          <div>
            <h1>我的家庭</h1>
            <p className="page-head__sub">每个家庭空间的数据相互独立，家人只能看到自己家的内容。</p>
          </div>
          <div className="page-head__actions">
            <Button variant="primary" onClick={() => setOpen(true)}>
              建立一个家庭空间
            </Button>
          </div>
        </div>

        {memberships.length === 0 ? (
          <EmptyState
            icon="🏠"
            title="还没有加入任何家庭"
            description="如果你是第一个使用者，直接建立家庭空间；如果家人已经建好，请用他们发来的邀请链接加入。"
            action={
              <Button variant="primary" onClick={() => setOpen(true)}>
                建立家庭空间
              </Button>
            }
          />
        ) : (
          <div className="grid-cards">
            {memberships.map((m) => (
              <Link key={m.familyId} to={`/f/${m.familyId}`} className="item-card" style={{ padding: 'var(--space-4)' }}>
                <h2 style={{ marginBottom: 'var(--space-2)' }}>{m.familyName}</h2>
                <div className="item-card__meta">
                  <span>{ROLE_LABELS[m.role]}</span>
                  <span>·</span>
                  <span>{m.memberCount} 位家人</span>
                  <span>·</span>
                  <span>{m.itemCount} 件物品</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Modal
        open={open}
        title="建立家庭空间"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={!name.trim()}
              onClick={() => {
                setError(null);
                create.mutate();
              }}
            >
              创建
            </Button>
          </>
        }
      >
        <Field label="家庭名称" hint="例如「老张家」「外婆家的东西」" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
        </Field>
        <Field label="一句话说明" hint="选填，例如「记录爸妈家里的老物件」">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
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

