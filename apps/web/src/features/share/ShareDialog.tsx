import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Button, Field, Modal, TextInput } from '../../components/ui';

export function ShareDialog({
  open,
  fid,
  itemIds,
  onClose,
}: {
  open: boolean;
  fid: string;
  itemIds: string[];
  onClose: () => void;
}) {
  const [days, setDays] = useState(7);
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ shareLink: { url: string | null; token: string } }>(`/families/${fid}/share-links`, {
        itemIds,
        expiresInDays: days,
        password: password.trim() || null,
        label: label.trim() || null,
      }),
    onSuccess: (data) => {
      setUrl(`${window.location.origin}${data.shareLink.url ?? `/share/${data.shareLink.token}`}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '创建失败'),
  });

  const close = () => {
    setUrl(null);
    setPassword('');
    setLabel('');
    setError(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="分享给家人或朋友"
      onClose={close}
      footer={
        url ? (
          <Button variant="primary" onClick={close}>
            完成
          </Button>
        ) : (
          <>
            <Button onClick={close}>取消</Button>
            <Button
              variant="primary"
              loading={create.isPending}
              onClick={() => {
                setError(null);
                create.mutate();
              }}
            >
              生成链接
            </Button>
          </>
        )
      }
    >
      {url ? (
        <div>
          <p>把这个链接发给对方，任何人拿到链接{password ? '并输入密码后' : ''}就能查看（只能看，不能改）。</p>
          <TextInput readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="分享链接" />
          <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(url);
              }}
            >
              复制链接
            </Button>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 'var(--space-3)' }}>
            链接将在 {days} 天后自动失效，随时可以在设置里撤销。
          </p>
        </div>
      ) : (
        <>
          <p className="muted">将分享选中的 {itemIds.length} 条记录。</p>
          <Field label="有效期">
            <TextInput
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Math.min(90, Math.max(1, Number(e.target.value))))}
            />
          </Field>
          <Field label="访问密码" hint="选填；填了之后对方需要输入密码才能看">
            <TextInput value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} maxLength={64} />
          </Field>
          <Field label="备注" hint="选填，方便自己记账，例如「给二叔看看」">
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </Field>
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </Modal>
  );
}

