declare module '#auth-utils' {
  interface User {
    sub: string
    givenName?: string
    name?: string
    email?: string
    preferredUsername?: string
  }
}

export {}
