// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationDir = resolve('supabase/migrations')
const migrationFiles = readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()
const setupFiles = ['src/supabaseSchema.sql', 'supabase-bootstrap.sql']
const read = (path) => readFileSync(path, 'utf8').replace(/--[^\n]*/g, '')
const createdTables = (sql) => [...sql.matchAll(/create table if not exists (?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)]
const tableGrants = (sql) => [...sql.matchAll(/grant\s+([\w\s,]+?)\s+on\s+(?:table\s+)?([\w\s.,]+?)\s+to\s+([\w\s,]+);/gi)]
  .filter((match) => !/^(sequence|function|schema)\b/i.test(match[2]))
const hasGrant = (sql, table, role, privilege) => tableGrants(sql).some((match) =>
  match[1].split(',').map((value) => value.trim().toLowerCase()).includes(privilege)
  && match[2].split(',').map((value) => value.trim().replace(/^public\./, '')).includes(table)
  && match[3].split(',').map((value) => value.trim()).includes(role))

describe('explicit Data API grants', () => {
  for (const path of [...setupFiles, ...migrationFiles.map((name) => resolve(migrationDir, name))]) {
    const sql = read(path)
    const tables = createdTables(sql)
    if (!tables.length) continue

    it(`${path} grants access in the table-creation file`, () => {
      for (const [, table, definition] of tables) {
        for (const privilege of ['select', 'insert', 'update', 'delete']) {
          expect(hasGrant(sql, table, 'service_role', privilege), `${table}: backend ${privilege}`).toBe(true)
        }
        expect(hasGrant(sql, table, 'authenticated', 'select'), `${table}: browser access`)
          .toBe(table !== 'bank_connections')
        expect(hasGrant(sql, table, 'anon', 'select'), `${table}: private data`).toBe(false)
        if (/\bid\s+bigint\s+generated/i.test(definition)) {
          expect(sql).toMatch(new RegExp(`grant usage, select on sequence\\s+[\\s\\S]*?public\\.${table}_id_seq[\\s\\S]*?to authenticated, service_role;`, 'i'))
        }
      }
    })
  }

  it('repairs backend access without changing browser permissions or future defaults', () => {
    const repair = read(resolve(migrationDir, '20261021140000_explicit_data_api_privileges.sql'))
    const tables = new Set([...setupFiles, ...migrationFiles.map((name) => resolve(migrationDir, name))]
      .flatMap((path) => createdTables(read(path)).map((match) => match[1])))
    for (const table of tables) {
      expect(hasGrant(repair, table, 'service_role', 'select'), table).toBe(true)
    }
    expect(repair).not.toMatch(/\b(?:authenticated|anon|alter default privileges)\b/i)
    expect(repair).not.toMatch(/on all (?:tables|sequences)/i)
  })
})
