-- Old assignments have no captured provider consent; never resume them implicitly.
UPDATE chatgpt_inference_requests
SET state='cancelled',payload_encrypted='',result_encrypted=NULL
WHERE state IN ('queued','claimed');
ALTER TABLE chatgpt_inference_requests
ADD COLUMN provider_choice_version bigint CHECK(provider_choice_version>0);
