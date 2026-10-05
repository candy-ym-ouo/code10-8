import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Avatar, EmptyState, Select, Spinner, Tag } from '../../components/ui';
import { ACTION_LABELS } from '../../lib/constants';
import { formatDateTime } from '../../lib/format';
import type { AuditLog } from '../../api/types';

export function AuditPage() {
  const { fid } = useParams<{ fid: string }>();
  const [action, setAction] = useState('');

  const query = useQuery({
    queryKey: ['audit', fid, action],
    queryFn: () =>
      api.get<{ logs: AuditLog[] }>(`/families/${fid}/audit-logs?limit=120${action ? `&action=${action}` : ''}`),
    enabled: Boolean(fid),
  });

  const logs = query.data?.logs ?? [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>家庭动态</h1>
          <p className="page-head__sub">谁在什么时候新建、修改、删除了什么，都会留下记录。</p>
        </div>
        <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
          <label className="field__label" htmlFor="audit-action">
            只看某类操作
          </label>
          <Select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">全部操作</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {query.isLoading ? (
        <Spinner />
      ) : logs.length === 0 ? (
        <EmptyState icon="📝" title="还没有动态" description="家人开始建立条目后，这里会记录每一步操作。" />
      ) : (
        <section className="card">
          <div className="log-list">
            {logs.map((log) => (
              <div key={log.id} className="log-item">
                <Avatar name={log.actor.displayName} color={log.actor.avatarColor} size={34} />
                <div className="log-item__body">
                  <div className="row" style={{ gap: 'var(--space-2)' }}>
                    <strong>{log.actor.displayName}</strong>
                    <Tag>{ACTION_LABELS[log.action] ?? log.action}</Tag>
                    {log.targetType ? <span className="muted" style={{ fontSize: 12 }}>{log.targetType}</span> : null}
                  </div>
                  <div className="log-item__meta">
                    {formatDateTime(log.createdAt)}
                    {log.ip ? ` · ${log.ip}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

