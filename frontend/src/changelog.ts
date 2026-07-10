export type ChangelogEntry = {
  id: string
  date: string
  title: string
  body: string
}

export const CHANGELOG_SEEN_STORAGE_KEY = 'reprice.changelog.seen'

function isChangelogEntry(value: unknown): value is ChangelogEntry {
  if (!value || typeof value !== 'object') {
    return false
  }

  const entry = value as Record<string, unknown>

  return (
    typeof entry.id === 'string' &&
    typeof entry.date === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.body === 'string'
  )
}

export async function fetchChangelog(): Promise<ChangelogEntry[]> {
  try {
    const response = await fetch('/changelog.json')

    if (!response.ok) {
      return []
    }

    const data: unknown = await response.json()

    if (!Array.isArray(data)) {
      return []
    }

    return data.filter(isChangelogEntry)
  } catch {
    return []
  }
}
