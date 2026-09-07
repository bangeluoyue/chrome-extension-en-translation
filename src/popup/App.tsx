import './index.css'
import { openExtensionPage } from '../utils/navigation'

export default function App() {
  return (
    <div className="popup">
      <header className="popup__header">
        <span className="popup__title">网页翻译</span>
        <button className="popup__settings" onClick={() => openExtensionPage('settings')}>
          ⚙ 设置
        </button>
      </header>

      <section className="popup__section">
        <div className="popup__label">当前页面</div>
        <div className="popup__card">
          <div className="popup__article-title">文章标题（提取后显示，最多两行）</div>
          <div className="popup__status">提取状态：已就绪</div>
        </div>
      </section>

      <button className="btn btn--primary" onClick={() => openExtensionPage('result')}>
        一键翻译
      </button>
      <button className="btn btn--secondary" disabled>
        下载 Markdown
      </button>

      <p className="popup__hint">提示：翻译完成后即可下载</p>
    </div>
  )
}
