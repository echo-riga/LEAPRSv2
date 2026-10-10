export const CLIENT_AUTH_METHODS = ['none', 'client_secret_basic', 'client_secret_post'] as const;
export type ClientAuthMethod = typeof CLIENT_AUTH_METHODS[number];

export function validateClientRegistration(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid client metadata.');
  const metadata = input as Record<string, unknown>;
  const method = metadata.token_endpoint_auth_method ?? 'client_secret_basic';
  if (!CLIENT_AUTH_METHODS.includes(method as ClientAuthMethod)) throw new Error('Unsupported token endpoint authentication method.');
  if (metadata.scope !== undefined && metadata.scope !== 'mcp') throw new Error('Unsupported scope.');
  for (const [key, allowed] of [['grant_types', ['authorization_code', 'refresh_token']], ['response_types', ['code']]] as const) {
    const values = metadata[key];
    if (values !== undefined && (!Array.isArray(values) || !values.length || values.some(value => !allowed.includes(value as never)))) {
      throw new Error(`Unsupported ${key}.`);
    }
  }
  if (!Array.isArray(metadata.redirect_uris) || !metadata.redirect_uris.length || metadata.redirect_uris.length > 10) throw new Error('Provide 1 to 10 redirect URIs.');
  const redirectUris = metadata.redirect_uris.map(value => {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f]/.test(value)) throw new Error('Invalid redirect URI.');
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Invalid redirect URI.'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash || value.includes('*') ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) throw new Error('Redirect URIs require HTTPS, except local loopback callbacks.');
    return value;
  });
  if (new Set(redirectUris).size !== redirectUris.length) throw new Error('Duplicate redirect URI.');
  const clientName = metadata.client_name ?? 'AI app';
  if (typeof clientName !== 'string' || !clientName.trim() || clientName.length > 100 || /[\u0000-\u001f]/.test(clientName)) throw new Error('Invalid client name.');
  return { clientName: clientName.trim(), redirectUris, tokenEndpointAuthMethod: method as ClientAuthMethod };
}
