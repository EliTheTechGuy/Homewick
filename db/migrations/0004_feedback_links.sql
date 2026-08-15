-- A private link for each feedback request.
--
-- The customer has no account and should not need one to answer a question
-- about a clean that already happened. The link identifies the visit instead.
--
-- Only a hash is stored, as with sign in links. The raw token exists in the
-- emailed URL and nowhere else, so reading this table gives no way to submit
-- feedback as somebody else or to enumerate visits.

alter table visit_feedback add column token_hash text unique;

-- Finding the row from a link is the hot path.
create index on visit_feedback (token_hash) where token_hash is not null;

-- Answering is the whole point, so make the unanswered ones easy to count.
create index on visit_feedback (sent_at) where responded_at is null;
