import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { EmptyState, Spinner, Tag } from '../../components/ui';
import { CATEGORY_ICONS } from '../../lib/constants';
import { mediaSrc } from '../../lib/media';
import type { TimelineGroup } from '../../api/types';

export function TimelinePage() {
  const { fid } = useParams<{ fid: string }>();
  const query = useQuery({
    queryKey: ['timeline', fid],
    queryFn: () => api.get<{ groups: TimelineGroup[] }>(`/families/${fid}/timeline`),
    enabled: Boolean(fid),
  });

  if (query.isLoading) return <Spinner label="正在按时间整理…" />;
  const groups = query.data?.groups ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>时间轴</h1>
          <p className="page-head__sub">
            按获得时间排列。只记得大概年份的条目会落在对应年代，并标注「时间存疑」。
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon="🕰️"
          title="还没有可以上时间轴的记录"
          description="给条目补上「获得时间」后，它就会出现在这里。"
        />
      ) : (
        <div className="timeline">
          {groups.map((group) => (
            <section key={group.key} className="timeline__group">
              <div>
                <div className="timeline__year">{group.label}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {group.count} 件
                </div>
              </div>
              <div className="timeline__items">
                {group.items.map((item) => {
                  const cover = item.media.find((m) => m.thumbUrl);
                  return (
                    <Link key={item.id} to={`/f/${fid}/items/${item.id}`} className="timeline-row">
                      {cover?.thumbUrl ? (
                        <img className="timeline-row__thumb" src={mediaSrc(cover.thumbUrl)} alt="" loading="lazy" />
                      ) : (
                        <span className="timeline-row__thumb" aria-hidden="true">
                          {CATEGORY_ICONS[item.category]}
                        </span>
                      )}
                      <div className="timeline-row__body">
                        <div className="timeline-row__title">{item.title}</div>
                        <div className="item-card__meta">
                          <span>{item.acquiredDisplay}</span>
                          {item.placeText ? <span className="muted">· {item.placeText}</span> : null}
                          {item.timeUncertain ? <Tag tone="warn">时间存疑</Tag> : null}
                        </div>
                      </div>
                    </Link>
                  );
                })}
                {group.count > group.items.length ? (
                  <Link to={`/f/${fid}/items`} className="muted" style={{ fontSize: 13 }}>
                    还有 {group.count - group.items.length} 件，去物品列表看
                  </Link>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

