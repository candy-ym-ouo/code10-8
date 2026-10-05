import { useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Button, Tag } from '../../components/ui';
import { useToast } from '../../components/Toast';
import type { Media, MediaKind } from '../../api/types';
import { MEDIA_KIND_LABELS } from '../../lib/constants';
import { formatBytes } from '../../lib/format';

interface UploadTask {
  id: string;
  name: string;
  size: number;
  kind: MediaKind;
  status: 'uploading' | 'done' | 'error';
  message?: string;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,application/pdf';

function guessKind(file: File): MediaKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type === 'application/pdf') return 'document';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) return 'image';
  if (['mp3', 'm4a', 'wav', 'webm', 'ogg'].includes(ext)) return 'audio';
  return 'document';
}

export function MediaUploader({
  fid,
  itemId,
  onUploaded,
}: {
  fid: string;
  itemId: string;
  onUploaded: (media: Media) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [dragging, setDragging] = useState(false);
  const { push } = useToast();

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const kind = guessKind(file);
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      setTasks((prev) => [...prev, { id, name: file.name, size: file.size, kind, status: 'uploading' }]);

      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);

      try {
        const result = await api.upload<{ media: Media }>(`/families/${fid}/items/${itemId}/media`, form);
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'done' } : t)));
        onUploaded(result.media);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : '上传失败';
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'error', message } : t)));
        push(`${file.name}：${message}`, 'error');
      }
    }
  };

  return (
    <div>
      <div
        className={`dropzone${dragging ? ' dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
      >
        <p style={{ marginBottom: 'var(--space-3)' }}>
          把照片、录音或扫描件拖到这里，也可以直接选择文件
        </p>
        <Button onClick={() => inputRef.current?.click()}>选择文件</Button>
        <p className="muted" style={{ fontSize: 13, marginTop: 'var(--space-3)', marginBottom: 0 }}>
          支持 JPG / PNG / WebP / HEIC、MP3 / M4A / WAV / WebM / OGG 与 PDF
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {tasks.length > 0 ? (
        <div className="upload-list">
          {tasks.map((t) => (
            <div key={t.id} className={`upload-item${t.status === 'error' ? ' upload-item--error' : ''}`}>
              <span className="upload-item__name" title={t.name}>
                {t.name}
              </span>
              <span className="muted">{MEDIA_KIND_LABELS[t.kind]}</span>
              <span className="muted">{formatBytes(t.size)}</span>
              {t.status === 'uploading' ? <Tag tone="warn">上传中</Tag> : null}
              {t.status === 'done' ? <Tag tone="success">已保存</Tag> : null}
              {t.status === 'error' ? (
                <>
                  <Tag tone="warn">失败</Tag>
                  <span className="field__error">{t.message}</span>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

