import './index.css'
import { closeCurrentPage } from '../utils/navigation'

export default function App() {
  return (
    <div className="result">
      <header className="result__header">
        <button className="result__back" onClick={closeCurrentPage}>
          ← 返回
        </button>
        <span className="result__title">网页翻译结果</span>
        <div className="result__actions">
          <button className="btn btn--ghost">复制</button>
          <button className="btn btn--ghost">下载</button>
        </div>
      </header>

      <main className="result__body">
        <section className="result__meta">
          <h1 className="result__article-title">文章标题</h1>
          <blockquote className="result__quote">
            <div>作者：张三</div>
            <div>原文链接：https://example.com/article</div>
          </blockquote>
        </section>

        <section className="result__content">
          <p>这是翻译后的正文内容，正在逐字显示...▊</p>
          <p>第二段内容持续追加...</p>
          <p>![图片描述](https://example.com/img.png)</p>
        </section>
      </main>
    </div>
  )
}
