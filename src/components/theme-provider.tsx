import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  toggleTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )

  const getSystemTheme = (): "light" | "dark" => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
  }

  const applyTheme = (themeToApply: "light" | "dark") => {
    const root = document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(themeToApply)

    const id = "primereact-theme"
    const existingLink = document.getElementById(id) as HTMLLinkElement | null
    const themeHref =
      themeToApply === "dark"
        ? "https://unpkg.com/primereact/resources/themes/lara-dark-indigo/theme.css"
        : "https://unpkg.com/primereact/resources/themes/lara-light-indigo/theme.css"

    if (existingLink) {
      existingLink.href = themeHref
    } else {
      const link = document.createElement("link")
      link.id = id
      link.rel = "stylesheet"
      link.href = themeHref
      document.head.appendChild(link)
    }
  }

  useEffect(() => {
    const currentTheme = theme === "system" ? getSystemTheme() : theme
    applyTheme(currentTheme)
  }, [theme])

  const handleSetTheme = (newTheme: Theme) => {

    const applyNext = () => {
      localStorage.setItem(storageKey, newTheme)
      setTheme(newTheme)
    }

    if (document.startViewTransition) {
      document.startViewTransition(() => applyNext())
    } else {
      applyNext()
    }
  }

  const toggleTheme = () => {
    const currentResolved = theme === "system" ? getSystemTheme() : theme
    const next = currentResolved === "dark" ? "light" : "dark"

    const applyNext = () => {
      localStorage.setItem(storageKey, next)
      setTheme(next)
    }

    if (document.startViewTransition) {
      document.startViewTransition(() => applyNext())
    } else {
      applyNext()
    }
  }

  const value: ThemeProviderState = {
    theme,
    setTheme: handleSetTheme,
    toggleTheme,
  }

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)
  if (!context) throw new Error("useTheme must be used within ThemeProvider")
  return context
}