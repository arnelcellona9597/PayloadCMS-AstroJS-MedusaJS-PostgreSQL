-- Two SEPARATE databases, one per backend.
--
-- This is an architectural statement, not a convenience:
-- Payload and Medusa each own their own migration history and schema.
-- They never share tables and never join across each other.
-- All integration between them happens over HTTP, in the Astro layer.
--
-- The `postgres` database itself is left alone so you can always connect
-- to the container even if both app databases are dropped.

CREATE DATABASE payload_crud;
CREATE DATABASE medusa_crud;
