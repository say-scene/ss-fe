// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import IconButton from './IconButton';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('키보드 포커스로 설명을 보여주고 Escape로 닫는다', () => {
  render(<IconButton label="다시 듣기">icon</IconButton>);
  const button = screen.getByRole('button', { name: '다시 듣기' });
  fireEvent.focus(button);
  expect(screen.getByRole('tooltip')).toHaveTextContent('다시 듣기');
  fireEvent.keyDown(button, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
it('길게 누르면 설명만 표시하고 이어지는 클릭은 실행하지 않는다', () => {
  vi.useFakeTimers();
  const click = vi.fn();
  render(<IconButton label="수정하기" onClick={click}>icon</IconButton>);
  const button = screen.getByRole('button', { name: '수정하기' });
  fireEvent.pointerDown(button, { pointerType: 'touch' });
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole('tooltip')).toHaveTextContent('수정하기');
  fireEvent.pointerUp(button);
  fireEvent.click(button);
  expect(click).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1800));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.pointerDown(button, { pointerType: 'touch' });
  fireEvent.pointerUp(button);
  fireEvent.click(button);
  expect(click).toHaveBeenCalledTimes(1);
});
