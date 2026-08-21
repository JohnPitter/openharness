/**
 * Durable OAuth token file under the harness home.
 * @module dsh-llm-pi-ai/oauth-path
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** JSON document pi-ai CredentialStore writes, one credential per provider id. */
export const OAUTH_AUTH_FILE = 'pi-ai-oauth.json'

/**
 * Absolute path of the OAuth credential document.
 * `$DSH_HOME` wins when set (OpenHarness isolates this under LocalAppData);
 * otherwise `~/.dsh`, matching the rest of the harness.
 */
export function oauthAuthPath(): string {
  const fromEnv = process.env.DSH_HOME?.trim()
  const home = fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : join(homedir(), '.dsh')
  return join(home, OAUTH_AUTH_FILE)
}
