/** Shared verifier used by backend and credential-owning desktop runtime. */
export {
  createOpenAiIdentityVerifier,
  createOpenAiRefreshIdentityVerifier,
  type VerifiedOpenAiIdentity,
} from "@orbyn/api-client/openai-identity";
