import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button, Spinner } from '../../components/ui';
import { ImageGallery } from '../media/ImageGallery';
import { CATEGORY_LABELS } from '../../lib/constants';
import { formatDate } from '../../lib/format';
import type { ItemDetail } from '../../api/types';

export function ItemPrintPage() {
  const { fid, itemId } = useParams<{ fid: string; itemId: string }>();
  const query = useQuery({
    queryKey: ['item', fid, itemId],
    queryFn: () => api.get<{ item: ItemDetail }>(`/families/${fid}/items/${itemId}`),
    enabled: Boolean(fid && itemId),
  });

  if (query.isLoading) return <Spinner />;
  const item = query.data?.item;
  if (!item) return <p>找不到这条记录。</p>;

  return (
    <article style={{ background: '#fff', padding: 'var(--space-5)', borderRadius: 'var(--radius)' }}>
      <div className="row row--between no-print" style={{ marginBottom: 'var(--space-4)' }}>
        <Button onClick={() => window.history.back()}>返回</Button>
        <Button variant="primary" onClick={() => window.print()}>
          打印 / 存为 PDF
        </Button>
      </div>

      <h1 className="detail-title">{item.title}</h1>
      <p className="muted">
        {CATEGORY_LABELS[item.category]} · {item.acquiredDisplay}
      </p>

      <hr className="divider" />

      <div className="fact-list" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="fact">
          <span className="fact__label">来源人物</span>
          <span className="fact__value">{item.people.map((p) => p.name).join('、') || '未记录'}</span>
        </div>
        <div className="fact">
          <span className="fact__label">地点</span>
          <span className="fact__value">
            {[item.placeProvince, item.placeCity, item.placeText].filter(Boolean).join(' ') || '未记录'}
          </span>
        </div>
        <div className="fact">
          <span className="fact__label">存放位置</span>
          <span className="fact__value">{item.storageLocation || '未记录'}</span>
        </div>
        <div className="fact">
          <span className="fact__label">保存状况</span>
          <span className="fact__value">{item.condition || '未记录'}</span>
        </div>
      </div>

      {item.storyHtml ? <div className="story" dangerouslySetInnerHTML={{ __html: item.storyHtml }} /> : null}

      <ImageGallery media={item.media.filter((m) => m.kind === 'image')} />

      <hr className="divider" />
      <p className="muted" style={{ fontSize: 12 }}>
        打印时间 {formatDate(new Date().toISOString())} · 由「家中物品来历册」导出
      </p>
    </article>
  );
}

