import './index.css'
import { closeCurrentPage } from '../utils/navigation'

export default function App() {
  return (
    <div className="settings">
      <header className="settings__header">
        <button className="settings__back" onClick={closeCurrentPage}>
          ← 返回
        </button>
        <span className="settings__title">设置</span>
      </header>

      <main className="settings__body">
        <form className="settings__form" onSubmit={(e) => e.preventDefault()}>
          <label className="settings__field">
            <span className="settings__label">API Key</span>
            <input className="settings__input" type="password" placeholder="sk-xxxxxxxxxxxxxxxx" />
          </label>

          <label className="settings__field">
            <span className="settings__label">模型</span>
            <select className="settings__input" defaultValue="qwen-plus">
              <option value="qwen-plus">qwen-plus</option>
              <option value="qwen-max">qwen-max</option>
            </select>
          </label>

          <label className="settings__field">
            <span className="settings__label">Base URL</span>
            <input
              className="settings__input"
              type="text"
              defaultValue="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
          </label>

          <button className="btn btn--primary" type="submit">
            保存
          </button>
        </form>
      </main>
    </div>
  )
}
