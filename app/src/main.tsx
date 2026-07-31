import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { I18nProvider } from "@/providers/i18n"
import { LessonGenerationProvider } from "@/providers/LessonGeneration"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TRPCProvider>
      {/* Inside tRPC, because the language follows the signed-in account and
          that needs a session to read. Still above everything that renders a
          word, which is what matters. */}
      <I18nProvider>
      {/* Above the router on purpose: a lesson generation has to survive the
          author navigating to another page and back. */}
      <LessonGenerationProvider>
        <App />
      </LessonGenerationProvider>
      </I18nProvider>
    </TRPCProvider>
  </BrowserRouter>,
)
