import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Button, Spinner } from '../../components/ui';
import { useAuth } from './AuthContext';
import { ROLE_LABELS } from '../../lib/constants';
import type { FamilyRole } from '../../api/types';
import { useToast } from '../../components/Toast';

interface InvitePreview {
  familyId: string;
  familyName: string;
  familyDescription: string | null;
  role: FamilyRole;
  expiresAt: string;
  remainingUses: number;
}

export function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const { user, status, reloadMemberships } = useAuth();
  const navigate = useNavigate();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['invite', code],
    queryFn: () => api.get<{ invite: InvitePreview }>(`/invites/${code}`),
    enabled: Boolean(code),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.post<{ familyId: string; role: FamilyRole; alreadyMember: boolean }>(`/invites/${code}/accept`),
    onSuccess: async (result) => {
      await reloadMemberships();
      push(result.alreadyMember ? '你已经在这个家庭里了' : '已加入家庭', 'success');
      navigate(`/f/${result.familyId}`, { replace: true });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '加入失败'),
  });

  if (status === 'loading' || preview.isLoading) {
    return (
      <div className="auth-page">
        <Spinner label="正在读取邀请…" />
      </div>
    );
  }

  if (preview.error || !preview.data) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>邀请已失效</h1>
          <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
            {preview.error instanceof ApiError ? preview.error.message : '这个邀请链接不存在或已经过期。'}
          </p>
          <Link className="btn" to="/">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const invite = preview.data.invite;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__head">
          <h1>加入「{invite.familyName}」</h1>
          <p>
            邀请你以 <strong>{ROLE_LABELS[invite.role]}</strong> 的身份加入
          </p>
        </div>
        {!user ? (
          <>
            <p className="muted">请先登录或注册账号，然后会自动回到这里完成加入。</p>
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <Link className="btn btn--primary" to="/login" state={{ from: `/join/${code}` }}>
                去登录
              </Link>
              <Link className="btn" to="/register" state={{ from: `/join/${code}` }}>
                注册新账号
              </Link>
            </div>
          </>
        ) : (
          <>
            <Button variant="primary" loading={accept.isPending} onClick={() => accept.mutate()} style={{ width: '100%' }}>
              确认加入
            </Button>
            {error ? (
              <p className="field__error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

