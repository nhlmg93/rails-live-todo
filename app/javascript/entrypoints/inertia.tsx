import { createInertiaApp } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'
import { ComponentType } from 'react'

interface PageModule {
  default: ComponentType
}

createInertiaApp({
  progress: {
    delay: 250,
    color: '#4f46e5',
    includeCSS: true,
    showSpinner: false,
  },
  resolve: (name) => {
    const pages = import.meta.glob<PageModule>('../pages/**/*.tsx', { eager: true })
    return pages[`../pages/${name}.tsx`]
  },
  setup({ el, App, props }) {
    createRoot(el!).render(<App {...props} />)
  },
})
