import { useEffect, useRef } from 'react';
import { Button } from '../../components/ui';

/**
 * 极简富文本编辑器：只保留叙述需要的加粗/斜体/列表/引用。
 * 服务端会用白名单再净化一次，所以这里即便被绕过也不会写入危险标签。
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
    // 仅在外部 value 变化时同步，避免输入过程光标跳动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const exec = (command: string) => {
    ref.current?.focus();
    document.execCommand(command, false);
    onChange(ref.current?.innerHTML ?? '');
  };

  return (
    <div>
      <div className="row" style={{ gap: 4, marginBottom: 8 }}>
        <Button type="button" size="sm" variant="ghost" onClick={() => exec('bold')} aria-label="加粗">
          <strong>B</strong>
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => exec('italic')} aria-label="斜体">
          <em>I</em>
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => exec('insertUnorderedList')} aria-label="列表">
          • 列表
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => exec('formatBlock')} aria-label="引用">
          ❝ 引用
        </Button>
      </div>
      <div
        ref={ref}
        className="input input--area story"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="物品的故事"
        data-placeholder={placeholder}
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        onBlur={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        suppressContentEditableWarning
      />
      {value.trim() === '' ? (
        <p className="field__hint" style={{ marginTop: 4 }}>
          {placeholder}
        </p>
      ) : null}
    </div>
  );
}

