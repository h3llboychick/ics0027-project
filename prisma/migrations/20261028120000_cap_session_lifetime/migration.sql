-- Apply the 24-hour session policy to sessions created before the configuration change.
-- Preserve any earlier expiry, including sessions that have already expired.
UPDATE "session"
SET "expiresAt" = "createdAt" + INTERVAL '24 hours'
WHERE "expiresAt" > "createdAt" + INTERVAL '24 hours';
