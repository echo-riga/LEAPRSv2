export type RequestNotificationContext = {
  requestorName?: string | null;
  setting?: string | null;
  requestedBudget?: string | number | null;
};

type NotificationCopyInput = {
  title: string;
  message: string;
  type: string;
};

const settingLabels: Record<string, string> = {
  internal: 'In-House',
  external: 'External',
};

function clean(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ') || '';
}

function statusUpdateLabel(title: string) {
  const marked = title.match(/Update:\s*\[([^\]]+)]/i)?.[1];
  if (marked) return `Update status: ${marked.charAt(0).toUpperCase()}${marked.slice(1).toLowerCase()}`;
  if (/Request Reopened/i.test(title)) return 'Request reopened';
  if (/Request Stopped/i.test(title)) return 'Progress stopped';
  if (/Request Resumed/i.test(title)) return 'Progress resumed';
  return '';
}

function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '';
}

// Stored events stay immutable. Request-linked notifications are enriched at read/delivery
// time so historical rows receive the same clear wording as newly created events.
export function formatRequestNotification(
  event: NotificationCopyInput,
  request: RequestNotificationContext | null | undefined,
  inactivityText?: string,
) {
  if (!request) return {
    title: event.title,
    message: event.message,
  };

  const requestor = clean(request.requestorName) || 'Requestor';
  const setting = settingLabels[clean(request.setting).toLowerCase()] || 'CapDev';
  const amount = money(request.requestedBudget);

  if (event.type === 'new_request') {
    return {
      title: `New ${setting} request: ${requestor}`,
      message: amount ? `Requested ${amount}.` : '',
    };
  }

  if (event.type === 'inactivity_reminder') {
    const reminder = inactivityText || event.message.match(/No progress for \d+ days\./i)?.[0] || event.message;
    return {
      title: `No activity: ${requestor}`,
      message: reminder,
    };
  }

  if (event.type === 'completed' || event.type === 'denied') {
    const outcome = event.type === 'completed' ? 'completed' : 'denied';
    const legacyResolution = /^The request for .+ was resolved as (completed|denied)\.?$/i.test(event.message.trim());
    return {
      title: `Request ${outcome}: ${requestor}`,
      message: legacyResolution ? '' : clean(event.message),
    };
  }

  if (event.type === 'status_update') {
    const updateLabel = statusUpdateLabel(event.title);
    return {
      title: `${requestor}'s Request Timeline`,
      message: [updateLabel, clean(event.message)].filter(Boolean).join(' • '),
    };
  }

  const replaceLegacyRequestNumber = (text: string) => text.replace(
    /\b(Request|request)\s*#\d+\b/g,
    (_, word: string) => `${word} for ${requestor}`,
  );
  return {
    title: replaceLegacyRequestNumber(event.title),
    message: replaceLegacyRequestNumber(event.message),
  };
}
