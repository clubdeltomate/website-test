import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { LessonGenerationProvider } from "@/providers/LessonGeneration"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TRPCProvider>
      {/* Above the router on purpose: a lesson generation has to survive the
          author navigating to another page and back. */}
      <LessonGenerationProvider>
        <App />
      </LessonGenerationProvider>
    </TRPCProvider>
  </BrowserRouter>,
)
