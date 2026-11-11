import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { mountEngine } from './engine';
import './style.css';

function App() {
  const room = useRef<HTMLElement>(null);
  useEffect(() => {
    const engine = mountEngine(room.current!);
    return () => engine.dispose();
  }, []);
  const desktop = !!window.__MUYU_NATIVE__ || new URLSearchParams(location.search).has('desktop');
  return (
    <main className={'room' + (desktop ? ' desktop' : '')} ref={room}>
      <header className="masthead">
        <a className="wordmark" href="#main"><span className="seal" aria-hidden="true">一</span><span>一念<span className="wordmark-en">YI NIAN</span></span></a>
        <span className="edition">给日常，留一点空白 <i /> Nº 02</span>
      </header>
      <section className="experience" id="main" aria-labelledby="title">
        <div className="intro"><p className="eyebrow"><i /> A SMALL RITUAL</p><h1 id="title">一声木鱼，<span>一刻清静。</span></h1><p className="subtitle">随时间流转，在你选好的时段里，慢慢轻敲。</p></div>
        <div className="control-group">
          <div className="stage"><div className="world-switch" role="slider" tabIndex={0} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={1440} aria-valuenow={0} aria-label="一天中的时间" aria-describedby="help"><canvas aria-hidden="true" /></div></div>
          <div className="control-labels" aria-hidden="true"><span>00:00</span><span className="drag-hint">连续拖动 · 预览一天中的任意时刻</span><span>24:00</span></div>
        </div>
        <div className="timebar"><span className="time-mode">当地时间</span><span className="time-value">00:00</span><button className="return-clock" type="button" disabled>正跟随现在</button></div>
        <div className="console">
          <div className="count-group"><span className="count-caption">本次已敲</span><span className="counter" aria-label="本次敲击次数">0000</span><span className="count-unit">声</span><button className="reset-button" type="button" aria-label="清零本次敲击次数" title="从零开始">↺</button></div>
          <div className="console-divider" />
          <div className="tempo-control"><span className="setting-caption">节奏</span><div className="tempo-options" role="group" aria-label="敲击速度">{[40, 60, 90].map(bpm => <button key={bpm} className="tempo-button" type="button" data-bpm={bpm} aria-pressed={bpm === 60} aria-label={`每分钟 ${bpm} 次`}>{bpm}</button>)}</div><span className="tempo-unit">次 / 分</span></div>
          <div className="console-divider" />
          <button type="button" className="sound-button" aria-pressed="false" aria-label="开启木鱼声音"><span className="sound-icon" aria-hidden="true"><i /><i /><i /></span><span className="sound-label">开启声音</span></button>
        </div>
        <div className="world-caption"><span className="status-dot" /><span className="status-label">正在轻敲</span><span className="caption-dot">·</span><span className="sound-hint">默认静音，声音由你开启</span></div>
        <details className="schedule" open={!desktop}><summary><span>每日敲击时段</span><span className="schedule-summary">08:00–12:00 · 14:30–17:30</span><i aria-hidden="true" /></summary><div className="schedule-body"><div className="schedule-rows" /><div className="schedule-bottom"><button type="button" className="add-period">＋ 添加时段</button><span className="schedule-hint">每天重复 · 修改即保存</span></div></div></details>
        <p id="help" className="sr-only">滑块表示 00:00 至 24:00，自动跟随本机时间。连续拖动可预览任意时刻；松手保留预览时间，不会吸附到两端。方向键调整十五分钟，Home 与 End 到两端，回车或空格恢复当前时间。仅设定时段内自动敲击。</p>
        <p id="live-status" className="sr-only" aria-live="polite" aria-atomic="true" />
      </section>
      <footer className="footer"><span>一念 · 木鱼小庭院</span><span>时间到了，自然响起。</span><span className="footer-key"><kbd>←</kbd><kbd>→</kbd> 调整时间</span></footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
