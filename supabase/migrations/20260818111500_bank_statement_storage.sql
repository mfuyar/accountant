-- Original import files live in the existing private accounting document bucket.
-- Bank statements can be larger than ordinary receipts, matching the UI upload limit.
update storage.buckets
set file_size_limit = 10485760
where id = 'accounting-documents';
