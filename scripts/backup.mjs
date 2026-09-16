import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

process.umask(0o077)
const root = path.resolve(import.meta.dirname, '..')
const destination = path.join(os.homedir(), 'GreenfortBackups')
const keyDir = path.join(os.homedir(), '.config', 'greenfort-backup')
const keyFile = path.join(keyDir, 'recovery.key')
const base = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) throw new Error('Supabase URL and service-role key are required')
await fs.mkdir(destination, { recursive: true, mode: 0o700 })
await fs.mkdir(keyDir, { recursive: true, mode: 0o700 })
try { await fs.writeFile(keyFile, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 }) } catch (e) { if (e.code !== 'EEXIST') throw e }
const stamp = new Date().toISOString().replaceAll(':', '-')
const work = await fs.mkdtemp(path.join(destination, '.partial-'))
const manifest = { startedAt: new Date().toISOString(), kind: 'API data export, not a transactional PostgreSQL dump', tables: {}, files: [], limitations: ['No database roles, live SQL definitions, auth password hashes, or server secrets.', 'Data is read sequentially; concurrent changes can affect consistency. Local SQL files may differ from the deployed schema.'] }
const headers = { apikey: key, Authorization: `Bearer ${key}` }
async function request(endpoint, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(base + endpoint, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(120000) })
      if (!r.ok) throw new Error(`Backup request failed: HTTP ${r.status}`)
      return r
    } catch (e) { if (attempt === 2) throw e }
  }
}
async function save(name, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data, null, 2))
  const target = path.join(work, name)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, buffer)
  manifest.files.push({ path: name, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') })
}
try {
  const schema = await (await request('/rest/v1/', { headers: { Accept: 'application/openapi+json' } })).json()
  if (!Object.keys(schema.definitions || {}).length) throw new Error('No database relations discovered; refusing an empty backup')
  await save('api-schema.json', schema)
  for (const [table, def] of Object.entries(schema.definitions || {})) {
    const order = Object.keys(def.properties || {}).filter(k => /primary key/i.test(def.properties[k].description || ''))
    const sorting = order.length ? order.join(',') : Object.hasOwn(def.properties || {}, 'id') ? 'id' : Object.keys(def.properties || {}).join(',')
    const rows = []
    for (let offset = 0;;) {
      const page = await (await request(`/rest/v1/${encodeURIComponent(table)}?select=*&order=${encodeURIComponent(sorting)}&limit=500&offset=${offset}`)).json()
      if (!Array.isArray(page)) throw new Error('Invalid table export')
      if (!page.length) break
      rows.push(...page); offset += page.length
    }
    await save(`tables/${table}.json`, rows)
    manifest.tables[table] = rows.length
  }
  const users = []
  for (let page = 1;;page++) {
    const data = await (await request(`/auth/v1/admin/users?page=${page}&per_page=100`)).json()
    if (!Array.isArray(data.users)) throw new Error('Invalid user export')
    users.push(...data.users)
    if (data.users.length < 100) break
  }
  await save('auth-user-metadata.json', users)
  const buckets = await (await request('/storage/v1/bucket')).json()
  await save('storage-buckets.json', buckets)
  let objectCount = 0
  async function walk(bucket, prefix = '') {
    for (let offset = 0;;) {
      const objects = await (await request(`/storage/v1/object/list/${encodeURIComponent(bucket)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }) })).json()
      if (!Array.isArray(objects)) throw new Error('Invalid storage listing')
      if (!objects.length) break
      for (const object of objects) {
        const name = prefix ? `${prefix}/${object.name}` : object.name
        if (!object.id) { await walk(bucket, name); continue }
        const encoded = [bucket, ...name.split('/')].map(encodeURIComponent).join('/')
        const data = Buffer.from(await (await request(`/storage/v1/object/authenticated/${encoded}`)).arrayBuffer())
        // Encode each component so remote object names cannot escape the archive directory.
        const localName = `storage/${[bucket, ...name.split('/')].map(s => encodeURIComponent(s).replaceAll('.', '%2E')).join('/')}`
        await save(localName, data)
        manifest.files.at(-1).storage = { bucket, name, metadata: object.metadata }
        objectCount++
      }
      offset += objects.length
    }
  }
  for (const bucket of buckets) await walk(bucket.id)
  await fs.cp(path.join(root, 'supabase', 'migrations'), path.join(work, 'local-schema', 'migrations'), { recursive: true })
  await fs.copyFile(path.join(root, 'src', 'supabaseSchema.sql'), path.join(work, 'local-schema', 'supabaseSchema.sql'))
  manifest.completedAt = new Date().toISOString()
  manifest.objectCount = objectCount
  await fs.writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2))
  const tar = path.join(work, 'archive.tar.gz')
  execFileSync('/usr/bin/tar', ['-czf', tar, '--exclude=archive.tar.gz', '-C', work, '.'])
  const archive = path.join(destination, `greenfort-${stamp}.tar.gz.enc`)
  execFileSync('/usr/bin/openssl', ['enc', '-aes-256-cbc', '-salt', '-pbkdf2', '-iter', '200000', '-in', tar, '-out', archive + '.partial', '-pass', `file:${keyFile}`])
  const verify = path.join(work, 'verify.tar.gz')
  execFileSync('/usr/bin/openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-in', archive + '.partial', '-out', verify, '-pass', `file:${keyFile}`])
  const digest = async p => createHash('sha256').update(await fs.readFile(p)).digest('hex')
  if (await digest(tar) !== await digest(verify)) throw new Error('Encryption verification failed')
  execFileSync('/usr/bin/tar', ['-tzf', verify], { stdio: 'ignore' })
  await fs.rename(archive + '.partial', archive)
  await fs.writeFile(archive + '.sha256', await digest(archive) + '\n')
  await fs.writeFile(path.join(destination, 'latest-status.json'), JSON.stringify({ completedAt: manifest.completedAt, archive, tables: Object.keys(manifest.tables).length, rows: Object.values(manifest.tables).reduce((a,b) => a+b,0), storageObjects: objectCount, verified: true }, null, 2))
  // Retention only runs after a successful, verified backup.
  for (const name of await fs.readdir(destination)) {
    if (!/^greenfort-.*\.tar\.gz\.enc(?:\.sha256)?$/.test(name)) continue
    const file = path.join(destination, name)
    if (Date.now() - (await fs.stat(file)).mtimeMs > 30 * 86400000) await fs.unlink(file)
  }
  console.log(await fs.readFile(path.join(destination, 'latest-status.json'), 'utf8'))
} finally { await fs.rm(work, { recursive: true, force: true }) }
