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

function markedStatusLabel(title: string) {
  const marked = title.match(/Update:\s*\[([^\]]+)]/i)?.[1];
  return marked ? `${marked.charAt(0).toUpperCase()}${marked.slice(1).toLowerCase()}` : '';
}

function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
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
      title: `${requestor}'s Request`,
      message: reminder,
    };
  }

  if (event.type === 'completed' || event.type === 'denied') {
    const outcome = event.type === 'completed' ? 'completed' : 'denied';
    const legacyResolution = /^The request for .+ was resolved as (completed|denied)\.?$/i.test(event.message.trim());
    return {
      title: `${requestor}'s Request ${outcome === 'completed' ? 'Completed' : 'Denied'}`,
      message: legacyResolution ? '' : clean(event.message),
    };
  }

  if (event.type === 'status_update') {
    const detail = clean(event.message);
    let message: string;
    if (/Request Reopened/i.test(event.title)) {
      message = 'Request reopened';
    } else if (/Request Stopped/i.test(event.title)) {
      const reason = detail.replace(/^.*?\bstopped progress:\s*/i, '');
      message = ['Progress stopped', reason].filter(Boolean).join(' • ');
    } else if (/Request Resumed/i.test(event.title)) {
      message = 'Progress resumed';
    } else {
      message = [markedStatusLabel(event.title), detail].filter(Boolean).join(' • ');
    }
    return {
      title: `${requestor}'s Request Update`,
      message,
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
