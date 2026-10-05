import { useState } from 'react';
import { mediaSrc } from '../../lib/media';
import type { Media } from '../../api/types';

export function ImageGallery({ media }: { media: Media[] }) {
  const [zoomed, setZoomed] = useState<Media | null>(null);
  const images = media.filter((m) => m.kind === 'image');
  if (images.length === 0) return null;

  return (
    <>
      <div className="gallery">
        {images.map((m) => (
          <button
            key={m.id}
            type="button"
            className="gallery__item"
            onClick={() => setZoomed(m)}
            aria-label={`查看大图：${m.caption || m.originalName}`}
          >
            <img src={mediaSrc(m.thumbUrl ?? m.rawUrl)} alt={m.caption || m.originalName} loading="lazy" />
            {m.caption ? <span className="gallery__caption">{m.caption}</span> : null}
          </button>
        ))}
      </div>
      {zoomed ? (
        <div className="lightbox" onClick={() => setZoomed(null)} role="presentation">
          <img src={mediaSrc(zoomed.rawUrl)} alt={zoomed.caption || zoomed.originalName} />
        </div>
      ) : null}
    </>
  );
}

