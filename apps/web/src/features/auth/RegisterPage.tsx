import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button, Field, TextInput } from '../../components/ui';
import { ApiError } from '../../api/client';
import { useAuth } from './AuthContext';

export function RegisterPage() {
  const { register, user, status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'ready' && user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email.trim(), password, displayName.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__head">
          <h1>创建账号</h1>
          <p>如果是家人邀请你加入，请从邀请链接进入。</p>
        </div>
        <form onSubmit={submit}>
          <Field label="你的称呼" hint="会显示在条目和动态里" required>
            <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={40} autoFocus />
          </Field>
          <Field label="邮箱" required>
            <TextInput type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field
            label="密码"
            hint="至少 8 位，需同时包含字母和数字"
            error={error}
            required
          >
            <TextInput
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </Field>
          <Button type="submit" variant="primary" loading={busy} style={{ width: '100%' }}>
            注册
          </Button>
        </form>
        <p className="auth-switch">
          已经有账号？<Link to="/login">去登录</Link>
        </p>
      </div>
    </div>
  );
}

