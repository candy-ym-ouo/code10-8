import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button, EmptyState, Spinner, Tag } from '../../components/ui';
import { ItemCard } from '../items/ItemCard';
import { PERSON_ROLE_LABELS } from '../../lib/constants';
import type { PersonDetail } from '../../api/types';

export function PersonDetailPage() {
  const { fid, personId } = useParams<{ fid: string; personId: string }>();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['person', fid, personId],
    queryFn: () => api.get<{ person: PersonDetail }>(`/families/${fid}/people/${personId}`),
    enabled: Boolean(fid && personId),
  });

  if (query.isLoading) return <Spinner />;
  const person = query.data?.person;
  if (!person) return <EmptyState title="找不到这个人物" action={<Button onClick={() => navigate(-1)}>返回</Button>} />;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{person.name}</h1>
          <p className="page-head__sub">
            {person.relation ? `${person.relation} · ` : ''}
            {person.birthYear ? `${person.birthYear}${person.deathYear ? `–${person.deathYear}` : ''}` : '年份未记录'}
          </p>
        </div>
        <Button onClick={() => navigate(-1)}>返回</Button>
      </div>

      {person.bio ? (
        <section className="card">
          <h2 style={{ marginBottom: 'var(--space-2)' }}>小传</h2>
          <p style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{person.bio}</p>
        </section>
      ) : null}

      <section>
        <h2 style={{ marginBottom: 'var(--space-3)' }}>相关的物品（{person.items.length}）</h2>
        {person.items.length === 0 ? (
          <EmptyState
            icon="📦"
            title="还没有关联的物品"
            description="在记录物品时选择这位人物，就会在这里出现。"
          />
        ) : (
          <div className="grid-cards">
            {person.items.map((item) => (
              <div key={`${item.id}-${item.role}`}>
                <ItemCard item={item} fid={fid!} />
                <Tag>{PERSON_ROLE_LABELS[item.role]}</Tag>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

