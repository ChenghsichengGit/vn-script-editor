import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { eventChannel, useOutsideClick } from '../hooks';

export interface RubyRequest {
  x: number; // 畫面座標：框的左上角
  y: number;
  base: string; // 要標的文字（顯示在框裡提醒）
  rt: string; // 原本的讀音（新標的是空的）
  onSubmit: (rt: string) => void; // 空字串 = 拿掉
  onClose?: () => void; // 不管套用或取消，關掉後呼叫（例如把焦點還給編輯器）
}

const channel = eventChannel<RubyRequest>('vn-ruby-prompt');
export const openRubyPrompt = channel.open;

export default function RubyPromptHost() {
  const [req, setReq] = channel.useValue();
  if (!req) return null;
  const close = () => {
    setReq(null);
    req.onClose?.();
  };
  return <RubyPrompt key={`${req.x},${req.y},${req.base}`} req={req} onClose={close} />;
}

function RubyPrompt({ req, onClose }: { req: RubyRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rt, setRt] = useState(req.rt);
  const [pos, setPos] = useState({ left: req.x, top: req.y });
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(req.x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(req.y, window.innerHeight - r.height - 4)) });
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [req.x, req.y]);
  useOutsideClick(ref, onClose);
  const submit = (value: string) => {
    req.onSubmit(value.trim());
    onClose();
  };
  return createPortal(
    <div className="ruby-prompt" ref={ref} style={pos}>
      <span className="ruby-prompt-base" title={req.base}>{req.base}</span>
      <input
        ref={inputRef}
        value={rt}
        placeholder="讀音"
        spellCheck={false}
        onChange={(e) => setRt(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit(rt);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <button type="button" className="ruby-prompt-btn" onClick={() => submit(rt)}>標音</button>
      {req.rt && (
        <button type="button" className="ruby-prompt-btn" onClick={() => submit('')}>拿掉</button>
      )}
    </div>,
    document.body,
  );
}
