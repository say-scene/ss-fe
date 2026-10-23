import { useState } from 'react';
import { scenarios, type Scenario } from './scenarios';
import ExpressionTools from './ExpressionTools';
import './chat.css';
import './home.css';
const placeImages: Partial<Record<Scenario['id'], string>> = {
  'cafe-order': '/images/places/cafe.png',
  'restaurant-order': '/images/places/restaurant.png',
  'clothes-shopping': '/images/places/clothes.png',
  'subway-route': '/images/places/subway.png',
  'street-directions': '/images/places/street.png',
  'hotel-checkin': '/images/places/hotel.png',
  'market-shopping': '/images/places/market.png',
  'pharmacy-visit': '/images/places/pharmacy.png',
  'phone-reservation': '/images/places/phone.png',
  'infra-interview': '/images/places/interview.png',
};
export default function Home({ onStart, resume, disabled = false }: { onStart: (scenario: Scenario) => void; resume?: { title: string; onClick: () => void }; disabled?: boolean }) {
  const [selected, setSelected] = useState<Scenario>(scenarios[0]);
  const [vocabularyOpen, setVocabularyOpen] = useState(false);
  return <div className="home-shell">
    <ExpressionTools sessionId="home" scenarioId={selected.id} open={vocabularyOpen} onClose={() => setVocabularyOpen(false)} />
    <aside className="chat-sidebar" aria-label="선택한 대화 안내">
      <a className="wordmark" href="#home">Say<span>Scene</span><i>●</i></a>
      <div className="sidebar-label">오늘의 대화</div>
      <div className="current-scene"><span aria-hidden="true">{selected.emoji}</span><div>{selected.title}<small>{selected.place} · 영어 연습</small></div><span className="active-dot" /></div>
      <div className="scene-guide"><span className="eyebrow">YOUR SCENE</span><h2>오늘의 장면을<br/>골라보세요.</h2><p>장소를 고르고 상황을 확인한 뒤<br/>나만의 속도로 대화를 시작하세요.</p><div className="guide-tags"><span>{selected.place}</span></div></div>
      <div className="sidebar-bottom"><img src="/sayscene-logo.png" alt="SayScene 말풍선 친구"/><p>완벽하지 않아도 괜찮아요.<br/>한 장면씩, 나만의 속도로.</p><a href="#demo">연결 확인 화면 ↗</a></div>
    </aside>
    <main className="home-main">
    <header className="home-header"><span className="home-page-label">영어 대화 연습</span><a className="wordmark home-mobile-logo" href="#home">Say<span>Scene</span><i>●</i></a><nav aria-label="학습 기록"><a href="#reports">Report 다시보기</a><button onClick={() => setVocabularyOpen(true)}>단어장</button></nav></header>
    <div className="home-content">
    <section className="home-intro"><p>한 장면씩, 나만의 속도로</p><h1>오늘은 어디에서 말해볼까요?</h1><p>장소와 상황을 골라 영어로 대화해 보세요.</p></section>
    {resume && <section className="resume-card"><h2>진행 중인 대화</h2><p>{resume.title}</p><button className="primary" disabled={disabled} onClick={resume.onClick}>이어서하기 →</button></section>}
    <section className="home-selection" aria-labelledby="places-title"><h2 id="places-title">1. 장소 선택</h2><div className="home-cards" role="group" aria-label="장소 선택">{scenarios.map(scenario => <button key={scenario.id} className="place-card" aria-pressed={selected.id === scenario.id} onClick={() => setSelected(scenario)}>{placeImages[scenario.id] ? <img className="place-image" src={placeImages[scenario.id]} alt="" width="140" height="92" decoding="async" /> : <span className="empty-scene-image" aria-hidden="true"/>}<strong>{scenario.emoji} {scenario.place}</strong></button>)}</div></section>
    <section className="home-selection" aria-labelledby="situations-title"><h2 id="situations-title">2. 상황 선택</h2><div className="home-situations" role="group" aria-label="상황 선택"><button className="situation-card" aria-pressed="true"><strong>{selected.title}</strong><span>{selected.situation}</span></button></div></section>
    <footer className="home-start"><p>{selected.place} · {selected.situation}</p><button className="primary" disabled={disabled} onClick={() => onStart(selected)}>시작하기 →</button></footer>
    </div>
    </main>
  </div>;
}
