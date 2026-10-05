import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Button, EmptyState, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { formatDateTime } from '../../lib/format';
import type { Item } from '../../api/types';

export function TrashPage() {
  const { fid } = useParams<{ fid: string }>();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const query = useQuery({
    queryKey: ['trash', fid],
    queryFn: () => api.get<{ items: Item[] }>(`/families/${fid}/items/trash`),
    enabled: Boolean(fid),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['trash', fid] });
    await queryClient.invalidateQueries({ queryKey: ['items', fid] });
  };

  const restore = useMutation({
    mutationFn: (itemId: string) => api.post(`/families/${fid}/items/${itemId}/restore`),
    onSuccess: async () => {
      push('已恢复', 'success');
      await invalidate();
    },
    onError: (err) => push(err instanceof ApiError ? err.message : '恢复失败', 'error'),
  });

  const purge = useMutation({
    mutationFn: (itemId: string) => api.del(`/families/${fid}/items/${itemId}/purge`),
    onSuccess: async () => {
      push('已彻底删除，相关文件也已清理', 'success');
      await invalidate();
    },
    onError: (err) => push(err instanceof ApiError ? err.message : '删除失败', 'error'),
  });

  if (query.isLoading) return <Spinner />;
  const items = query.data?.items ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>回收站</h1>
          <p className="page-head__sub">删除的条目会在这里保留 30 天，到期后自动彻底清除。</p>
        </div>
        <Link className="btn" to={`/f/${fid}/settings`}>
          返回设置
        </Link>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="🗑️" title="回收站是空的" description="被删除的条目会出现在这里。" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>类别</th>
                <th>删除时间</th>
                <th style={{ width: 200 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{item.category}</td>
                  <td>{item.acquiredDisplay}</td>
                  <td>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <Button size="sm" loading={restore.isPending} onClick={() => restore.mutate(item.id)}>
                        恢复
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          if (window.confirm(`彻底删除「${item.title}」？相关图片和录音也会一并删除，无法恢复。`)) {
                            purge.mutate(item.id);
                          }
                        }}
                      >
                        彻底删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ marginTop: 'var(--space-4)', fontSize: 13 }}>
        最后更新时间：{items[0] ? formatDateTime(items[0].updatedAt) : '—'}
      </p>
    </div>
  );
}

