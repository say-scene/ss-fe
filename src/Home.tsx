import { useState } from 'react';
import { scenarios, type Scenario } from './scenarios';
import ExpressionTools from './ExpressionTools';
import './home.css';
export default function Home({ onStart }: { onStart: (scenario: Scenario) => void }) {
  const [selected, setSelected] = useState<Scenario>(scenarios[0]);
  const [vocabularyOpen, setVocabularyOpen] = useState(false);
  return <main className="home-shell">
    <ExpressionTools sessionId="home" scenarioId={selected.id} open={vocabularyOpen} onClose={() => setVocabularyOpen(false)} />
    <header className="home-header"><a className="wordmark" href="#home">Say<span>Scene</span><i>●</i></a><nav aria-label="학습 기록"><button disabled title="준비 중">Report 다시보기</button><button onClick={() => setVocabularyOpen(true)}>단어장</button></nav></header>
    <section className="home-intro"><p>한 장면씩, 나만의 속도로</p><h1>오늘은 어디에서 말해볼까요?</h1><p>장소와 상황을 골라 영어로 대화해 보세요.</p></section>
    <section aria-labelledby="places-title"><h2 id="places-title">1. 장소 선택</h2><div className="home-cards" role="group" aria-label="장소 선택">{scenarios.map(scenario => <button key={scenario.id} className="place-card" aria-pressed={selected.id === scenario.id} onClick={() => setSelected(scenario)}><span className="empty-scene-image" aria-hidden="true"/><strong>{scenario.emoji} {scenario.place}</strong></button>)}</div></section>
    <section aria-labelledby="situations-title"><h2 id="situations-title">2. 상황 선택</h2><div className="home-cards" role="group" aria-label="상황 선택"><button className="situation-card" aria-pressed="true"><strong>{selected.title}</strong><span>{selected.situation}</span></button></div></section>
    <footer className="home-start"><p>{selected.place} · {selected.situation}</p><button className="primary" onClick={() => onStart(selected)}>시작하기 →</button></footer>
  </main>;
}
