import { createInertiaApp } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'

createInertiaApp({
  progress: {
    delay: 250,
    color: '#4f46e5',
    includeCSS: true,
    showSpinner: false,
  },
  resolve: name => {
    const pages = import.meta.glob('../pages/**/*.jsx', { eager: true })
    return pages[`../pages/${name}.jsx`]
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />)
  },
})
