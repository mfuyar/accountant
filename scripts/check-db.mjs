// Uses the same browser-safe credentials as the app. Never logs returned rows.
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (or their VITE_ equivalents).')
  process.exit(1)
}

const endpoint = new URL('/rest/v1/projects?select=id&limit=1', url)
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const rows = await response.json()
    if (!Array.isArray(rows)) throw new Error('Unexpected database response')
    console.log(`Database check passed at ${new Date().toISOString()} (HTTP ${response.status}).`)
    break
  } catch (error) {
    // Avoid logging URLs, credentials, or database contents on failure.
    console.error(`Database check attempt ${attempt}/3 failed (${error.name}).`)
    if (attempt === 3) process.exit(1)
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
}
