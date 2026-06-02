import { QueryClient } from '@tanstack/react-query'

// Singleton — imported by main.jsx (provider) and api.js (interceptor invalidations)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,   // data considered fresh for 30s
      gcTime:   90_000,    // evict inactive cache entries after 90s
                           // (default was 5 min — too long for heavy image/gallery lists)
    },
  },
})

export default queryClient
