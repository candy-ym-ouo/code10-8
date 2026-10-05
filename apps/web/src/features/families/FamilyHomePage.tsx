import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button, EmptyState, Spinner, Tag } from '../../components/ui';
import { useFamily } from './useFamily';
import { CATEGORY_ICONS, CATEGORY_LABELS } from '../../lib/constants';
import { formatBytes, formatNumber, relativeTime } from '../../lib/format';
import type { FamilyStats, Page, Item } from '../../api/types';

export function FamilyHomePage() {
  const { fid } = useParams<{ fid: string }>();
  const { data: familyData } = useFamily(fid);
  const navigate = useNavigate();

  const stats = useQuery({
    queryKey: ['family', fid, 'stats'],
    queryFn: () => api.get<FamilyStats>(`/families/${fid}/stats`),
    enabled: Boolean(fid),
  });

  const recent = useQuery({
    queryKey: ['items', fid, { sort: 'updated', limit: 6 }],
    queryFn: () => api.get<Page<Item>>(`/families/${fid}/items?sort=updated&limit=6`),
    enabled: Boolean(fid),
  });

  const role = familyData?.myRole;
  const canCreate = role !== undefined && role !== 'viewer';

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{familyData?.family.name ?? '家庭空间'}</h1>
          <p className="page-head__sub">
            {familyData?.family.description ?? '把每件旧物的时间、来历和故事记下来，家里人随时都能翻。'}
          </p>
        </div>
        <div className="page-head__actions">
          {canCreate ? (
            <Button variant="primary" onClick={() => navigate(`/f/${fid}/items/new`)}>
              记一件物品
            </Button>
          ) : null}
          <Button onClick={() => navigate(`/f/${fid}/timeline`)}>看时间轴</Button>
        </div>
      </div>

      {stats.isLoading ? (
        <Spinner label="正在统计…" />
      ) : stats.data ? (
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value">{formatNumber(stats.data.totalItems)}</div>
            <div className="stat__label">已建档的物品</div>
          </div>
          <div className="stat">
            <div className="stat__value">{formatNumber(stats.data.totalMedia)}</div>
            <div className="stat__label">图片 / 录音 / 文件</div>
          </div>
          <div className="stat">
            <div className="stat__value">{formatBytes(stats.data.totalBytes)}</div>
            <div className="stat__label">媒体占用空间</div>
          </div>
          <div className="stat">
            <div className="stat__value">{formatNumber(stats.data.recentItems)}</div>
            <div className="stat__label">最近 30 天新增</div>
          </div>
        </div>
      ) : null}

      {stats.data && stats.data.byCategory.length > 0 ? (
        <div className="card">
          <div className="card__head">
            <h2>按类别</h2>
            <Link to={`/f/${fid}/items`} style={{ fontSize: 14 }}>
              查看全部
            </Link>
          </div>
          <div className="row">
            {stats.data.byCategory.map((c) => (
              <Link key={c.category} className="tag" to={`/f/${fid}/items?category=${c.category}`}>
                <span aria-hidden="true">{CATEGORY_ICONS[c.category]}</span>
                {CATEGORY_LABELS[c.category]} · {c.count}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="card__head" style={{ marginBottom: 'var(--space-3)' }}>
          <h2>最近有更新</h2>
          <Link to={`/f/${fid}/items`} style={{ fontSize: 14 }}>
            全部物品
          </Link>
        </div>
        {recent.isLoading ? (
          <Spinner />
        ) : recent.data && recent.data.items.length > 0 ? (
          <div className="grid-cards">
            {recent.data.items.map((item) => (
              <Link key={item.id} to={`/f/${fid}/items/${item.id}`} className="item-card">
                <div className="item-card__thumb">
                  {item.media.find((m) => m.thumbUrl)?.thumbUrl ? (
                    <img src={item.media.find((m) => m.thumbUrl)!.thumbUrl!} alt="" loading="lazy" />
                  ) : (
                    <span aria-hidden="true">{CATEGORY_ICONS[item.category]}</span>
                  )}
                </div>
                <div className="item-card__body">
                  <span className="item-card__title">{item.title}</span>
                  <div className="item-card__meta">
                    <span>{item.acquiredDisplay}</span>
                    {item.timeUncertain ? <Tag tone="warn">时间存疑</Tag> : null}
                  </div>
                  <div className="item-card__foot">
                    <span className="muted" style={{ fontSize: 12 }}>
                      {relativeTime(item.updatedAt)}更新
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="📦"
            title="还没有任何条目"
            description="从一件最有故事的老物件开始吧，比如柜子里的旧箱子、抽屉里的票据。"
            action={
              canCreate ? (
                <Button variant="primary" onClick={() => navigate(`/f/${fid}/items/new`)}>
                  记第一件物品
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

