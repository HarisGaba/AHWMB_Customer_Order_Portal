import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"
import "./index.css"
import App from "./App"
import { AuthGate } from "@/components/auth-gate"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

/** Entry for /pos. Loaded on its own so portal styles and POS styles never mix. */
export function mountPos(root: HTMLElement) {
  document.title = "AHWMB · POS"
  // Urdu item names use Noto Nastaliq Urdu (allowed by the site's CSP via Google Fonts).
  const font = document.createElement("link")
  font.rel = "stylesheet"
  font.href = "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap"
  document.head.appendChild(font)
  document.body.style.background = "var(--background)"
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
        <TooltipProvider>
          <AuthGate>
            <App />
          </AuthGate>
          <Toaster position="bottom-right" duration={2500} richColors closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>,
  )
}
