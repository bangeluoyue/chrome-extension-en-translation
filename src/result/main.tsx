import ReactDOM from 'react-dom/client'
import App from './App'

// 开发模式下 StrictMode 会重复执行副作用，流式翻译页需避免发起两次计费请求。
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
