import { manilaDate, manilaDateBoundary } from '@/lib/manila-date';

type Project = { id: number; aipCode: string; department: string; initialBudget: string; createdAt: string };
type Request = { id: number; capdevId: number; requestorName: string | null; description: string; setting: string; status: string; isStopped: boolean; activeStopperId: number | null; createdAt: string };
type RequestEvent = {
  id?: string;
  requestId: number;
  createdAt: string;
  complete: boolean;
  denied: boolean;
  stopped: boolean;
  resumed: boolean;
  deductedAmount: string | null;
};
type Filters = { departments: string[]; capdevIds: number[]; dateFrom: string; dateTo: string; snapshotDate: string };

const cents = (value: string) => Math.round(Number(value) * 100);

export function summarizeAnalytics(
  data: { capdevs: Project[]; requests: Request[]; requestEvents: RequestEvent[] },
  filters: Filters,
  currentDate = manilaDate(),
) {
  const activityFrom = manilaDateBoundary(filters.dateFrom).getTime();
  const activityTo = manilaDateBoundary(filters.dateTo, true).getTime();
  const snapshotAt = manilaDateBoundary(filters.snapshotDate, true).getTime();
  const inActivityPeriod = (value: string) => {
    const time = Date.parse(value);
    return time >= activityFrom && time <= activityTo;
  };
  const selectedProjects = data.capdevs.filter((project) =>
    filters.departments.includes(project.department) && filters.capdevIds.includes(project.id)
  );
  const selectedProjectIds = new Set(selectedProjects.map((project) => project.id));
  const selectedRequests = data.requests.filter((request) => selectedProjectIds.has(request.capdevId));
  const selectedRequestIds = new Set(selectedRequests.map((request) => request.id));
  const activityProjects = selectedProjects.filter((project) => inActivityPeriod(project.createdAt));
  const activityRequests = selectedRequests.filter((request) => inActivityPeriod(request.createdAt));
  const completedRequestIds = new Set(data.requestEvents.filter((event) =>
    event.complete && selectedRequestIds.has(event.requestId) && inActivityPeriod(event.createdAt)
  ).map((event) => event.requestId));
  const budgetDeductedCents = data.requestEvents.reduce((total, event) =>
    event.deductedAmount && selectedRequestIds.has(event.requestId) && inActivityPeriod(event.createdAt)
      ? total + cents(event.deductedAmount)
      : total, 0);

  const snapshotProjects = selectedProjects.filter((project) => Date.parse(project.createdAt) <= snapshotAt);
  const snapshotProjectIds = new Set(snapshotProjects.map((project) => project.id));
  const eventsByRequest = new Map<number, RequestEvent[]>();
  for (const event of data.requestEvents) {
    const events = eventsByRequest.get(event.requestId) || [];
    events.push(event);
    eventsByRequest.set(event.requestId, events);
  }
  for (const events of eventsByRequest.values()) events.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  let inProgressCount = 0;
  let stoppedCount = 0;
  let incompleteHistoryCount = 0;
  const inProgressRequests: { request: Request; targetEventId?: string }[] = [];
  const stoppedRequests: { request: Request; targetEventId?: string }[] = [];
  const currentSnapshot = filters.snapshotDate >= currentDate;
  for (const request of selectedRequests) {
    if (!snapshotProjectIds.has(request.capdevId) || Date.parse(request.createdAt) > snapshotAt) continue;
    const allEvents = eventsByRequest.get(request.id) || [];
    const eventsAtSnapshot = allEvents.filter((event) => Date.parse(event.createdAt) <= snapshotAt);
    let concluded = eventsAtSnapshot.some((event) => event.complete || event.denied);
    let stopped = false;
    let stoppedEventId: string | undefined;
    for (const event of eventsAtSnapshot) {
      if (event.stopped) {
        stopped = true;
        stoppedEventId = event.id;
      }
      if (event.resumed) {
        stopped = false;
        stoppedEventId = undefined;
      }
    }
    if (currentSnapshot) {
      concluded ||= request.status === 'completed' || request.status === 'denied';
      if (!concluded) {
        stopped = request.isStopped;
        if (stopped && request.activeStopperId) stoppedEventId = `timeline-${request.activeStopperId}`;
      }
    } else if ((request.status === 'completed' || request.status === 'denied') &&
      !allEvents.some((event) => event.complete || event.denied)) {
      incompleteHistoryCount++;
      continue;
    }
    if (!concluded) {
      if (stopped) {
        stoppedCount++;
        stoppedRequests.push({ request, targetEventId: stoppedEventId });
      } else {
        inProgressCount++;
        inProgressRequests.push({ request, targetEventId: eventsAtSnapshot.at(-1)?.id });
      }
    }
  }

  const initialCents = snapshotProjects.reduce((total, project) => total + cents(project.initialBudget), 0);
  const requestsById = new Map(selectedRequests.map((request) => [request.id, request]));
  const utilizedCents = data.requestEvents.reduce((total, event) => {
    if (!event.deductedAmount || Date.parse(event.createdAt) > snapshotAt) return total;
    const request = requestsById.get(event.requestId);
    return request && snapshotProjectIds.has(request.capdevId) ? total + cents(event.deductedAmount) : total;
  }, 0);
  const allocations = Object.values(
    snapshotProjects.reduce<Record<string, { name: string; value: number }>>((totals, project) => {
      totals[project.department] ||= { name: project.department, value: 0 };
      totals[project.department].value += cents(project.initialBudget);
      return totals;
    }, {})
  ).map((allocation) => ({ ...allocation, value: allocation.value / 100 })).sort((a, b) => b.value - a.value);

  return {
    selectedProjects,
    activityProjects,
    activityRequests,
    completedRequests: selectedRequests.flatMap((request) => {
      if (!completedRequestIds.has(request.id)) return [];
      const event = data.requestEvents.find((item) => item.requestId === request.id && item.complete && inActivityPeriod(item.createdAt));
      return [{ request, targetEventId: event?.id }];
    }),
    completedCount: completedRequestIds.size,
    budgetDeducted: budgetDeductedCents / 100,
    inProgressCount,
    stoppedCount,
    inProgressRequests,
    stoppedRequests,
    incompleteHistoryCount,
    initialBudget: initialCents / 100,
    utilizedBudget: utilizedCents / 100,
    remainingBudget: (initialCents - utilizedCents) / 100,
    allocations,
    snapshotProjects,
  };
}
