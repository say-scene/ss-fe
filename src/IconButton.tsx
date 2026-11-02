import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { label: string };

export default function IconButton({ label, children, className = '', ...props }: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  function clearTimer() { clearTimeout(timer.current); }
  function hide() { clearTimer(); setVisible(false); }
  useEffect(() => () => clearTimeout(timer.current), []);
  return <span className="icon-action"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setVisible(true); }}
    onPointerLeave={hide}
    onFocus={() => setVisible(true)} onBlur={hide}
    onKeyDown={event => { if (event.key === 'Escape') hide(); }}
    onPointerDown={event => {
      clearTimer(); held.current = false;
      if (event.pointerType === 'mouse') return;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => { held.current = true; setVisible(true); }, 500);
    }}
    onPointerMove={event => {
      if (event.pointerType !== 'mouse' && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) hide();
    }}
    onPointerUp={() => {
      clearTimer();
      if (held.current) timer.current = setTimeout(() => setVisible(false), 1800);
    }}
    onPointerCancel={hide}
    onContextMenu={event => event.preventDefault()}
    onClickCapture={event => {
      // 길게 누른 뒤 손을 떼어도 버튼 동작은 실행하지 않는다.
      if (held.current) { event.preventDefault(); event.stopPropagation(); held.current = false; }
    }}>
    <button {...props} className={`chat-icon-button ${className}`} aria-label={label} aria-describedby={visible ? id : undefined}>{children}</button>
    {visible && <span id={id} role="tooltip" className="icon-tooltip">{label}</span>}
  </span>;
}
