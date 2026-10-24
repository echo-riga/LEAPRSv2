export async function getGoogleDriveAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken || !process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID) {
    throw new Error('Google Drive storage is not configured.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error('Unable to authorize Google Drive storage.');

  const token = await response.json() as { access_token?: string };
  if (!token.access_token) throw new Error('Google Drive did not return an access token.');
  return token.access_token;
}
