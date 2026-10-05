import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Avatar, Button, TextArea, Tag } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { relativeTime } from '../../lib/format';
import type { ItemDetail, Note } from '../../api/types';
import { useAuth } from '../auth/AuthContext';

const TYPE_LABELS: Record<Note['type'], string> = {
  story: '补充故事',
  comment: '留言',
  correction: '更正信息',
};

export function StoryThread({ fid, item }: { fid: string; item: ItemDetail }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [body, setBody] = useState('');
  const [type, setType] = useState<Note['type']>('story');
  const [error, setError] = useState<string | null>(null);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['item', fid, item.id] });
  };

  const create = useMutation({
    mutationFn: () => api.post(`/families/${fid}/items/${item.id}/notes`, { type, body: body.trim() }),
    onSuccess: async () => {
      setBody('');
      push('已经记下来了，等家人确认后会并入正文', 'success');
      await invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '提交失败'),
  });

  const accept = useMutation({
    mutationFn: (noteId: string) => api.post(`/families/${fid}/items/${item.id}/notes/${noteId}/accept`),
    onSuccess: async () => {
      push('已采纳并并入正文', 'success');
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ['items', fid] });
    },
    onError: (err) => push(err instanceof ApiError ? err.message : '采纳失败', 'error'),
  });

  const reject = useMutation({
    mutationFn: (noteId: string) =>
      api.post(`/families/${fid}/items/${item.id}/notes/${noteId}/reject`, { reason: '与事实不符或不适合并入正文' }),
    onSuccess: async () => {
      push('已驳回', 'success');
      await invalidate();
    },
    onError: (err) => push(err instanceof ApiError ? err.message : '驳回失败', 'error'),
  });

  const remove = useMutation({
    mutationFn: (noteId: string) => api.del(`/families/${fid}/items/${item.id}/notes/${noteId}`),
    onSuccess: async () => {
      push('已删除', 'success');
      await invalidate();
    },
    onError: (err) => push(err instanceof ApiError ? err.message : '删除失败', 'error'),
  });

  const visibleNotes = item.notes.filter((n) => n.status !== 'rejected');

  return (
    <section className="card">
      <div className="card__head">
        <h2>家人补充（{visibleNotes.length}）</h2>
        <span className="muted" style={{ fontSize: 13 }}>
          补充内容需要被采纳才会写进正文
        </span>
      </div>

      {visibleNotes.length === 0 ? (
        <p className="muted">还没有人补充。如果你记得更多细节，可以写在下面。</p>
      ) : (
        <div className="log-list" style={{ marginBottom: 'var(--space-4)' }}>
          {visibleNotes.map((note) => (
            <article key={note.id} className="log-item">
              {note.author ? <Avatar name={note.author.displayName} color={note.author.avatarColor} size={34} /> : null}
              <div className="log-item__body">
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  <strong>{note.author?.displayName ?? '家人'}</strong>
                  <Tag>{TYPE_LABELS[note.type]}</Tag>
                  {note.status === 'accepted' ? <Tag tone="success">已并入正文</Tag> : <Tag tone="warn">待确认</Tag>}
                  <span className="log-item__meta">{relativeTime(note.createdAt)}</span>
                </div>
                <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{note.body}</p>
                {item.permissions.canEdit && note.status === 'pending' ? (
                  <div className="row" style={{ gap: 'var(--space-2)', marginTop: 6 }}>
                    <Button size="sm" variant="primary" loading={accept.isPending} onClick={() => accept.mutate(note.id)}>
                      采纳并并入正文
                    </Button>
                    <Button size="sm" onClick={() => reject.mutate(note.id)}>
                      驳回
                    </Button>
                  </div>
                ) : null}
                {note.author?.id === user?.id || item.permissions.canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      if (window.confirm('确定删除这条内容吗？')) remove.mutate(note.id);
                    }}
                  >
                    删除
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {item.permissions.canComment ? (
        <div>
          <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            {(Object.keys(TYPE_LABELS) as Note['type'][]).map((t) => (
              <button
                key={t}
                type="button"
                className={`segmented__item${type === t ? ' segmented__item--active' : ''}`}
                aria-pressed={type === t}
                onClick={() => setType(t)}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <TextArea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="我记得这件东西还有这样一段故事…"
            maxLength={5000}
            aria-label="补充内容"
          />
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!body.trim()}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            提交补充
          </Button>
        </div>
      ) : (
        <p className="muted">你当前是只读成员，不能补充内容。</p>
      )}
    </section>
  );
}

