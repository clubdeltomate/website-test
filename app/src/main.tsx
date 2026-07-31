import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { I18nProvider } from "@/providers/i18n"
import { LessonGenerationProvider } from "@/providers/LessonGeneration"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    {/* Outermost of the app providers: every string below it, including the
        ones in error boundaries and toasts, is rendered in the chosen
        language. */}
    <I18nProvider>
    <TRPCProvider>
      {/* Above the router on purpose: a lesson generation has to survive the
          author navigating to another page and back. */}
      <LessonGenerationProvider>
        <App />
      </LessonGenerationProvider>
    </TRPCProvider>
    </I18nProvider>
  </BrowserRouter>,
)
