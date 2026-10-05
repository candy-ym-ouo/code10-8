import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Button, EmptyState, Select, Spinner, TextInput } from '../../components/ui';
import { ItemCard } from './ItemCard';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../lib/constants';
import type { Category, Item, Page, Person } from '../../api/types';
import { useFamily } from '../families/useFamily';

export function ItemListPage() {
  const { fid } = useParams<{ fid: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: familyData } = useFamily(fid);

  const q = params.get('q') ?? '';
  const category = (params.get('category') ?? '') as Category | '';
  const personId = params.get('personId') ?? '';
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? 'time';

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => {
      if (v) next.set(k, v);
      else next.delete(k);
    });
    setParams(next, { replace: true });
  };

  const people = useQuery({
    queryKey: ['people', fid],
    queryFn: () => api.get<{ people: Person[] }>(`/families/${fid}/people`),
    enabled: Boolean(fid),
  });

  const queryKey = useMemo(
    () => ['items', fid, { q, category, personId, status, sort }],
    [fid, q, category, personId, status, sort],
  );

  const list = useInfiniteQuery({
    queryKey,
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      search.set('limit', '24');
      search.set('sort', sort);
      if (q) search.set('q', q);
      if (category) search.set('category', category);
      if (personId) search.set('personId', personId);
      if (status) search.set('status', status);
      if (pageParam) search.set('cursor', pageParam);
      return api.get<Page<Item>>(`/families/${fid}/items?${search.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(fid),
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const role = familyData?.myRole;
  const canCreate = role !== undefined && role !== 'viewer';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>物品</h1>
          <p className="page-head__sub">家里的老家具、纪念品、票据和手稿，都在这里。</p>
        </div>
        {canCreate ? (
          <Button variant="primary" onClick={() => navigate(`/f/${fid}/items/new`)}>
            记一件物品
          </Button>
        ) : null}
      </div>

      <div className="segmented" style={{ marginBottom: 'var(--space-4)' }} role="tablist" aria-label="按类别筛选">
        <button
          type="button"
          role="tab"
          aria-selected={category === ''}
          className={`segmented__item${category === '' ? ' segmented__item--active' : ''}`}
          onClick={() => update({ category: '' })}
        >
          全部
        </button>
        {CATEGORY_ORDER.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            className={`segmented__item${category === c ? ' segmented__item--active' : ''}`}
            onClick={() => update({ category: c })}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="filters">
        <div className="field search-input">
          <label className="field__label" htmlFor="item-search">
            搜索
          </label>
          <TextInput
            id="item-search"
            type="search"
            placeholder="搜名字、故事、地点、标签、人物…"
            defaultValue={q}
            onChange={(e) => {
              const value = e.target.value;
              window.clearTimeout((window as unknown as { __t?: number }).__t);
              (window as unknown as { __t?: number }).__t = window.setTimeout(() => update({ q: value }), 300);
            }}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="item-person">
            来源人物
          </label>
          <Select id="item-person" value={personId} onChange={(e) => update({ personId: e.target.value })}>
            <option value="">全部</option>
            {(people.data?.people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="item-status">
            状态
          </label>
          <Select id="item-status" value={status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">全部</option>
            <option value="published">已发布</option>
            <option value="draft">草稿</option>
            <option value="archived">已归档</option>
          </Select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="item-sort">
            排序
          </label>
          <Select id="item-sort" value={sort} onChange={(e) => update({ sort: e.target.value })}>
            <option value="time">按获得时间</option>
            <option value="updated">按最近更新</option>
            <option value="created">按建档时间</option>
          </Select>
        </div>
      </div>

      {list.isLoading ? (
        <Spinner label="正在翻找…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="没有符合条件的物品"
          description={q || category || personId ? '换个条件再试试。' : '还没有建立任何条目。'}
          action={
            canCreate && !q && !category && !personId ? (
              <Button variant="primary" onClick={() => navigate(`/f/${fid}/items/new`)}>
                记第一件物品
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid-cards">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} fid={fid!} />
            ))}
          </div>
          {list.hasNextPage ? (
            <div style={{ textAlign: 'center', marginTop: 'var(--space-5)' }}>
              <Button loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                加载更多
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

