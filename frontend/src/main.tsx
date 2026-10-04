import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/sofia-sans-semi-condensed'
// Latin only: the one thing set in it is the name of the app.
import '@fontsource/russo-one/latin-400.css'
import './index.css'
import App from './App.tsx'
import { watchTheme } from './theme.ts'

watchTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
