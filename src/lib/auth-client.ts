import { createAuthClient } from "better-auth/react"
import { csrfFetch } from './security/csrf-client';
export const authClient = createAuthClient({ fetchOptions: { customFetchImpl: csrfFetch } })
