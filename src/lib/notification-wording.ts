// Historical notifications remain stored unchanged; display them with the current identifier.
export function requestNotificationWording(text: string, requestorName: string | null | undefined) {
  const name = requestorName?.trim() || 'Requestor';
  return text.replace(/\b(Request|request)\s*#\d+\b/g, (_, word: string) => `${word} for ${name}`);
}
