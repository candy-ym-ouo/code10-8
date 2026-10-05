import type { ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { useFamily } from '../features/families/useFamily';
import { Spinner } from '../components/ui';
import type { FamilyRole } from '../api/types';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="app-main">
        <Spinner label="正在恢复登录状态…" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/**
 * 家庭内页面的统一守卫：先确认是家庭成员，再按需校验角色。
 * 服务端仍会独立校验，这里只是避免无权限的用户看到一堆报错。
 */
export function RequireFamily({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: FamilyRole[];
}) {
  const { fid } = useParams<{ fid: string }>();
  const { data, isLoading, error } = useFamily(fid);

  if (isLoading) {
    return (
      <div className="app-main">
        <Spinner label="正在打开家庭空间…" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="app-main">
        <div className="empty">
          <h3 className="empty__title">打不开这个家庭空间</h3>
          <p className="empty__desc">可能你不在这个家庭里，或者链接已经失效。</p>
          <a className="btn" href="/">
            返回我的家庭
          </a>
        </div>
      </div>
    );
  }
  if (roles && !roles.includes(data.myRole)) {
    return (
      <div className="app-main">
        <div className="empty">
          <h3 className="empty__title">你没有这个页面的权限</h3>
          <p className="empty__desc">需要联系家庭管理员调整你的角色。</p>
          <a className="btn" href={`/f/${fid}`}>
            返回首页
          </a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

