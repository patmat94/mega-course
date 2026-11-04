-- Two-step uploads: upload without content returns a one-time upload_url; the bytes arrive by HTTP PUT.
ALTER TABLE files ADD COLUMN put_token TEXT;
ALTER TABLE files ADD COLUMN put_exp INTEGER;
