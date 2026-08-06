declare module '#auth-utils' {
  interface User {
    sub: string
    name?: string
    email?: string
    preferredUsername?: string
  }
}

export {}
