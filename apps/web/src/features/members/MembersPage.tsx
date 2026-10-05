import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Avatar, Button, Field, Modal, Select, Spinner, Tag, TextInput } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { useFamily } from '../families/useFamily';
import { ROLE_HINTS, ROLE_LABELS } from '../../lib/constants';
import { formatDate } from '../../lib/format';
import type { FamilyRole, Member } from '../../api/types';

interface Invite {
  id: string;
  role: FamilyRole;
  note: string | null;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revokedAt: string | null;
  createdAt: string;
}

export function MembersPage() {
  const { fid } = useParams<{ fid: string }>();
  const { user } = useAuth();
  const { data: familyData } = useFamily(fid);
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ role: 'contributor' as FamilyRole, days: 7, uses: 1, note: '' });
  const [generated, setGenerated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['members', fid],
    queryFn: () => api.get<{ members: Member[] }>(`/families/${fid}/members`),
    enabled: Boolean(fid),
  });

  const invites = useQuery({
    queryKey: ['invites', fid],
    queryFn: () => api.get<{ invites: Invite[] }>(`/families/${fid}/invites`),
    enabled: Boolean(fid),
  });

  const myRole = familyData?.myRole;
  const assignable: FamilyRole[] = myRole === 'owner' ? ['admin', 'editor', 'contributor', 'viewer'] : ['editor', 'contributor', 'viewer'];

  const createInvite = useMutation({
    mutationFn: () =>
      api.post<{ invite: { code: string; url: string } }>(`/families/${fid}/invites`, {
        role: inviteForm.role,
        expiresInDays: inviteForm.days,
        maxUses: inviteForm.uses,
        note: inviteForm.note.trim() || null,
      }),
    onSuccess: async (data) => {
      setGenerated(`${window.location.origin}${data.invite.url}`);
      await queryClient.invalidateQueries({ queryKey: ['invites', fid] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '生成失败'),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: FamilyRole }) =>
      api.patch(`/families/${fid}/members/${userId}`, { op: 'role', role }),
    onSuccess: async () => {
      push('权限已更新，对方需要重新登录后生效', 'success');
      await queryClient.invalidateQueries({ queryKey: ['members', fid] });
    },
    onError: (err) => push(err instanceof ApiError ? err.message : '修改失败', 'error'),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.del(`/families/${fid}/members/${userId}`),
    onSuccess: async () => {
      push('已移出家庭，该成员的登录状态已立即失效', 'success');
      await queryClient.invalidateQueries({ queryKey: ['members', fid] });
    },
    onError: (err) => push(err instanceof ApiError ? err.message : '移除失败', 'error'),
  });

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => api.del(`/families/${fid}/invites/${inviteId}`),
    onSuccess: async () => {
      push('邀请已撤销', 'success');
      await queryClient.invalidateQueries({ queryKey: ['invites', fid] });
    },
  });

  if (members.isLoading) return <Spinner />;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>家庭成员</h1>
          <p className="page-head__sub">权限修改后，对方需要重新登录才会生效；被移出的成员会立即失去访问。</p>
        </div>
        <Button variant="primary" onClick={() => setInviteOpen(true)}>
          邀请家人
        </Button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>成员</th>
              <th>邮箱</th>
              <th>角色</th>
              <th>加入时间</th>
              <th style={{ width: 160 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {(members.data?.members ?? []).map((m) => {
              const isMe = m.userId === user?.id;
              const canManage = m.role !== 'owner' && (myRole === 'owner' || (myRole === 'admin' && m.role !== 'admin'));
              return (
                <tr key={m.userId}>
                  <td>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <Avatar name={m.user.displayName} color={m.user.avatarColor} size={32} />
                      <span>
                        {m.user.displayName}
                        {isMe ? <span className="muted">（我）</span> : null}
                      </span>
                      {m.status === 'disabled' ? <Tag tone="warn">已停用</Tag> : null}
                    </div>
                  </td>
                  <td className="muted">{m.user.email}</td>
                  <td>
                    {canManage ? (
                      <Select
                        aria-label={`${m.user.displayName} 的角色`}
                        value={m.role}
                        onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as FamilyRole })}
                        style={{ maxWidth: 150 }}
                      >
                        <option value={m.role}>{ROLE_LABELS[m.role]}</option>
                        {assignable
                          .filter((r) => r !== m.role)
                          .map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                      </Select>
                    ) : (
                      <Tag>{ROLE_LABELS[m.role]}</Tag>
                    )}
                  </td>
                  <td className="muted">{formatDate(m.joinedAt)}</td>
                  <td>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          if (window.confirm(`确定把「${m.user.displayName}」移出家庭吗？他们会立即失去访问权限。`)) {
                            removeMember.mutate(m.userId);
                          }
                        }}
                      >
                        移出家庭
                      </Button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="card">
        <h2 style={{ marginBottom: 'var(--space-3)' }}>角色说明</h2>
        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          {(Object.keys(ROLE_LABELS) as FamilyRole[]).map((r) => (
            <div key={r} className="row" style={{ gap: 'var(--space-3)' }}>
              <Tag>{ROLE_LABELS[r]}</Tag>
              <span className="muted" style={{ fontSize: 14 }}>
                {ROLE_HINTS[r]}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 'var(--space-3)' }}>邀请记录</h2>
        {(invites.data?.invites ?? []).length === 0 ? (
          <p className="muted">还没有生成过邀请。</p>
        ) : (
          <div className="log-list">
            {(invites.data?.invites ?? []).map((inv) => {
              const expired = new Date(inv.expiresAt).getTime() < Date.now();
              const usable = !inv.revokedAt && !expired && inv.usedCount < inv.maxUses;
              return (
                <div key={inv.id} className="log-item">
                  <div className="log-item__body">
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <Tag>{ROLE_LABELS[inv.role]}</Tag>
                      <span>{inv.note || '未备注'}</span>
                      {usable ? <Tag tone="success">可用</Tag> : <Tag tone="muted">{inv.revokedAt ? '已撤销' : expired ? '已过期' : '已用尽'}</Tag>}
                    </div>
                    <div className="log-item__meta">
                      已使用 {inv.usedCount}/{inv.maxUses} · 有效期至 {formatDate(inv.expiresAt)}
                    </div>
                  </div>
                  {usable ? (
                    <Button size="sm" onClick={() => revokeInvite.mutate(inv.id)}>
                      撤销
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        open={inviteOpen}
        title="邀请家人加入"
        onClose={() => {
          setInviteOpen(false);
          setGenerated(null);
          setError(null);
        }}
        footer={
          generated ? (
            <Button variant="primary" onClick={() => setInviteOpen(false)}>
              完成
            </Button>
          ) : (
            <>
              <Button onClick={() => setInviteOpen(false)}>取消</Button>
              <Button variant="primary" loading={createInvite.isPending} onClick={() => {
                setError(null);
                createInvite.mutate();
              }}>
                生成邀请链接
              </Button>
            </>
          )
        }
      >
        {generated ? (
          <div>
            <p>把下面的链接发给家人（微信、短信都行）。链接只能用一次，过期后自动失效。</p>
            <TextInput readOnly value={generated} onFocus={(e) => e.currentTarget.select()} />
            <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <Button onClick={() => void navigator.clipboard.writeText(generated)}>复制链接</Button>
            </div>
          </div>
        ) : (
          <>
            <Field label="加入后的角色" required hint={ROLE_HINTS[inviteForm.role]}>
              <Select
                value={inviteForm.role}
                onChange={(e) => setInviteForm((p) => ({ ...p, role: e.target.value as FamilyRole }))}
              >
                {assignable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="form-grid">
              <Field label="有效天数">
                <TextInput
                  type="number"
                  min={1}
                  max={90}
                  value={inviteForm.days}
                  onChange={(e) => setInviteForm((p) => ({ ...p, days: Number(e.target.value) }))}
                />
              </Field>
              <Field label="可用次数">
                <TextInput
                  type="number"
                  min={1}
                  max={50}
                  value={inviteForm.uses}
                  onChange={(e) => setInviteForm((p) => ({ ...p, uses: Number(e.target.value) }))}
                />
              </Field>
            </div>
            <Field label="备注" hint="选填，例如「给小妹」">
              <TextInput value={inviteForm.note} onChange={(e) => setInviteForm((p) => ({ ...p, note: e.target.value }))} />
            </Field>
            {error ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}
      </Modal>
    </div>
  );
}

