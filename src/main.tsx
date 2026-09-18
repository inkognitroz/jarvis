import './lib/mmir-locale'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// No StrictMode: double-invoked effects would open the microphone twice.
createRoot(document.getElementById('root')!).render(<App />)
