import { useEffect, useState } from 'react';
import ChatRoom from './ChatRoom';
import DemoApp from './DemoApp';

export default function App() {
  const [demo, setDemo] = useState(window.location.hash === '#demo');
  useEffect(() => {
    const update = () => setDemo(window.location.hash === '#demo');
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return demo ? <><a className="chat-return" href="#chat">← 채팅방으로 돌아가기</a><DemoApp /></> : <ChatRoom />;
}
