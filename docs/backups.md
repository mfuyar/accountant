# Greenfort recovery exports

Run manually from this repository:

```sh
node --env-file=.env scripts/backup.mjs
```

The installed macOS LaunchAgent `com.greenfort.accountant.backup` runs at 9:15 AM
local time every Wednesday while this user's Mac session is available. A sleeping Mac can
run a missed calendar job on wake; a powered-off Mac cannot back up. This requires
network access, the existing Node installation, this checkout and its `.env`.

Archives: `~/GreenfortBackups/greenfort-*.tar.gz.enc`
Status: `~/GreenfortBackups/latest-status.json`
Errors: `~/GreenfortBackups/scheduler-error.log`
Recovery key: `~/.config/greenfort-backup/recovery.key`

Copy the recovery key into a password manager separately from an off-site copy
of the encrypted archives. Losing the key makes the archives unreadable. The
current installation stores both on this Mac; it does not protect against loss
of the Mac. Successful backups prune archives older than 30 days.

Each export includes all relations exposed by the authenticated Supabase REST
schema (including views), auth user metadata, every object in every accessible
Storage bucket, bucket metadata, the API schema, and local SQL migrations.
JSON files preserve record IDs and version history. No credentials from `.env`
are copied. Exported application records may themselves contain sensitive data.

This is NOT a complete PostgreSQL dump or a transactionally consistent snapshot.
It omits auth password hashes, live function/trigger/RLS definitions, roles,
non-exposed schemas and server secrets. Local migrations may differ from deployed
SQL. Avoid editing the app during a backup. For full disaster recovery, also
configure a direct database connection and `pg_dump`, or managed Supabase backups.
Database dumps alone do not include Storage file contents:
https://supabase.com/docs/guides/platform/backups

## Read or recover an archive

Use a private temporary directory on a trusted machine:

```sh
umask 077
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in /absolute/path/to/greenfort-backup.tar.gz.enc \
  -out /absolute/path/to/recovery.tar.gz \
  -pass file:"$HOME/.config/greenfort-backup/recovery.key"
tar -xzf /absolute/path/to/recovery.tar.gz -C /absolute/path/to/empty-recovery-directory
```

`manifest.json` contains SHA-256 hashes for exported data and objects, plus original
bucket/object names. Storage filenames inside the archive are encoded; use the
manifest names when restoring. Create a separate test project with matching SQL
schema, import base-table JSON in foreign-key dependency order (skip views such as
`active_costs`), restore bucket settings and objects, and separately restore/reset
auth access and server secrets. Review sequence values before new inserts.
Restoration is deliberately not automatic against production.

Every run verifies encryption/decryption byte equality and archive readability
before reporting success. This verifies the archive, not a full application restore.
