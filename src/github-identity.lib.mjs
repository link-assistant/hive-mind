/**
 * Identity helpers for tokens that cannot read `GET /user`.
 *
 * GitHub App installation tokens, including the Actions `GITHUB_TOKEN`, are
 * rejected by `gh api user` with HTTP 403 "Resource not accessible by
 * integration". That is a property of the token type, not a transient error,
 * so callers must not treat it as a failure of the work being verified.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */

const INTEGRATION_FORBIDDEN_PATTERN = /Resource not accessible by integration/i;

/**
 * @param {string} text - stderr/stdout of a failed `gh` call
 * @returns {boolean} true when the token is an integration token that lacks the endpoint
 */
export const isIntegrationForbidden = text => INTEGRATION_FORBIDDEN_PATTERN.test(String(text || ''));

/**
 * Decide whether an issue comment was written by this session's token.
 *
 * With a user token the login is known. With an integration token the login is
 * unknown, but every comment written by it carries `performed_via_github_app`.
 *
 * @param {object} comment - REST issue comment
 * @param {string|null} currentUser - authenticated login, or null for integration tokens
 * @returns {boolean}
 */
export const isCommentByCurrentIdentity = (comment, currentUser) => (currentUser ? comment?.user?.login === currentUser : Boolean(comment?.performed_via_github_app));
