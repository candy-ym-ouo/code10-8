import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, TextInput } from '../../components/ui';
import { ApiError } from '../../api/client';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const { login, user, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'ready' && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/'} replace />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__head">
          <h1>家中物品来历册</h1>
          <p>家里那些旧东西的来历，都记在这里。</p>
        </div>
        <form onSubmit={submit}>
          <Field label="邮箱" required>
            <TextInput
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="密码" required error={error}>
            <TextInput
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="primary" loading={busy} style={{ width: '100%' }}>
            登录
          </Button>
        </form>
        <p className="auth-switch">
          第一次使用？<Link to="/register">创建管理员账号</Link>
        </p>
      </div>
    </div>
  );
}

