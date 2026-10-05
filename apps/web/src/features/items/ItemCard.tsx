import { Link } from 'react-router-dom';
import type { Item } from '../../api/types';
import { CATEGORY_ICONS, CATEGORY_LABELS, STATUS_LABELS } from '../../lib/constants';
import { mediaSrc } from '../../lib/media';
import { Tag } from '../../components/ui';

export function ItemCard({ item, fid }: { item: Item; fid: string }) {
  const cover = item.media.find((m) => m.id === item.coverMediaId && m.thumbUrl) ?? item.media.find((m) => m.thumbUrl);
  const place = [item.placeProvince, item.placeCity, item.placeText].filter(Boolean).join(' ');

  return (
    <Link to={`/f/${fid}/items/${item.id}`} className="item-card">
      <div className="item-card__thumb">
        {cover?.thumbUrl ? (
          <img src={mediaSrc(cover.thumbUrl)} alt="" loading="lazy" />
        ) : (
          <span aria-hidden="true">{CATEGORY_ICONS[item.category]}</span>
        )}
      </div>
      <div className="item-card__body">
        <span className="item-card__title">{item.title}</span>
        <div className="item-card__meta">
          <span>{CATEGORY_LABELS[item.category]}</span>
          <span aria-hidden="true">·</span>
          <span>{item.acquiredDisplay}</span>
        </div>
        {place ? <div className="item-card__meta muted">{place}</div> : null}
        <div className="item-card__foot">
          {item.status !== 'published' ? <Tag tone="muted">{STATUS_LABELS[item.status]}</Tag> : null}
          {item.timeUncertain ? <Tag tone="warn">时间存疑</Tag> : null}
          {item.mediaCount > 0 ? <Tag>{item.mediaCount} 个附件</Tag> : null}
          {item.noteCount > 0 ? <Tag>{item.noteCount} 条补充</Tag> : null}
        </div>
      </div>
    </Link>
  );
}

