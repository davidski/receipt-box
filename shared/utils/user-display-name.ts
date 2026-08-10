export interface UserDisplayNameClaims {
  givenName?: string
  name?: string
  preferredUsername?: string
}

export function userDisplayName(user?: UserDisplayNameClaims | null): string | undefined {
  const givenName = user?.givenName?.trim()
  if (givenName) return givenName

  const name = user?.name?.trim()
  if (name) return name.split(/\s+/u)[0]

  const preferredUsername = user?.preferredUsername?.trim()
  return preferredUsername || undefined
}
