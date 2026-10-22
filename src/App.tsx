import { useEffect, useState } from 'react';
import ChatRoom from './ChatRoom';
import DemoApp from './DemoApp';
import Home from './Home';
import { scenarios } from './scenarios';

export default function App() {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const update = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const navigate = (hash: string) => { window.location.hash = hash; setRoute(hash); };
  if (route === '#demo') return <><a className="chat-return" href="#home">← 메인으로 돌아가기</a><DemoApp /></>;
  const scenario = scenarios.find(item => route === `#chat/${item.id}` || (route === '#chat' && item.id === 'cafe-order'));
  return scenario ? <ChatRoom key={scenario.id} scenario={scenario} autoStart={route !== '#chat'} onExit={() => navigate('#home')} />
    : <Home onStart={item => navigate(`#chat/${item.id}`)} />;
}
