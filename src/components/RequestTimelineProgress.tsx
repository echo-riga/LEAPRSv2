'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import {
  Check as CheckIcon,
  Close as CloseIcon,
  Flag as FlagIcon,
  MoreHoriz as PendingIcon,
  PlayArrow as ResumeIcon,
  PushPin as StopperIcon,
} from '@mui/icons-material';
import { getRequestById, getRequestStatusUpdates } from '@/app/actions';

type ProgressStep = 'completed' | 'denied' | 'pending' | 'stopper' | 'resumed' | 'final-completed' | 'final-denied';

type TimelineUpdate = {
  id: number;
  statusMark: string | null;
  isStopper: boolean;
  isStopperResponse: boolean;
  isResume: boolean;
  stopperId: number | null;
};

function stepAppearance(step: ProgressStep) {
  if (step === 'completed' || step === 'final-completed') return { color: '#2e7d32', icon: step === 'final-completed' ? <FlagIcon sx={{ fontSize: 17 }} /> : <CheckIcon sx={{ fontSize: 18 }} />, label: step === 'final-completed' ? 'Request completed' : 'Completed update' };
  if (step === 'denied' || step === 'final-denied') return { color: '#d32f2f', icon: <CloseIcon sx={{ fontSize: 18 }} />, label: step === 'final-denied' ? 'Request denied' : 'Denied update' };
  if (step === 'stopper') return { color: '#d32f2f', icon: <StopperIcon sx={{ fontSize: 15, transform: 'rotate(35deg)' }} />, label: 'Progress stopped' };
  if (step === 'resumed') return { color: '#2e7d32', icon: <ResumeIcon sx={{ fontSize: 18 }} />, label: 'Progress resumed' };
  return { color: '#8a938a', icon: <PendingIcon sx={{ fontSize: 20 }} />, label: 'Pending update' };
}

function ProgressNode({ step, isLast }: { step: ProgressStep; isLast: boolean }) {
  const { color, icon, label } = stepAppearance(step);
  return (
    <React.Fragment>
      <Tooltip title={label}>
        <Box aria-label={label} sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', bgcolor: color, color: '#fff', display: 'grid', placeItems: 'center', boxShadow: step.startsWith('final-') ? `0 0 0 3px #fafcfa, 0 0 0 5px ${color}` : 'none' }}>
          {icon}
        </Box>
      </Tooltip>
      {!isLast && <Box sx={{ width: 16, height: 3, flexShrink: 0, bgcolor: '#9ba19b', borderRadius: 2 }} />}
    </React.Fragment>
  );
}

export default function RequestTimelineProgress({ requestId }: { requestId: number }) {
  const [steps, setSteps] = useState<ProgressStep[]>([]);

  const loadProgress = useCallback(async () => {
    const [request, updates] = await Promise.all([getRequestById(requestId), getRequestStatusUpdates(requestId)]);
    if (!request) return;
    const timelineEvents = (updates as TimelineUpdate[]).filter(
      (update) => !update.isStopperResponse && !update.isResume
    );
    const resumedStopperIds = new Set(
      (updates as TimelineUpdate[])
        .filter((update) => update.isResume && update.stopperId !== null)
        .map((update) => update.stopperId)
    );
    const updateSteps = timelineEvents.map<ProgressStep>((update) => {
      if (update.isStopper) return resumedStopperIds.has(update.id) ? 'resumed' : 'stopper';
      if (update.statusMark === 'completed' || update.statusMark === 'accepted') return 'completed';
      if (update.statusMark === 'denied') return 'denied';
      return 'pending';
    });
    const finalStep: ProgressStep | null = request.status === 'completed' ? 'final-completed' : request.status === 'denied' ? 'final-denied' : null;
    setSteps(finalStep ? [...updateSteps, finalStep] : updateSteps);
  }, [requestId]);

  useEffect(() => {
    void Promise.resolve().then(loadProgress);
    const handleTimelineChange = (event: Event) => {
      if ((event as CustomEvent<number>).detail === requestId) void loadProgress();
    };
    window.addEventListener('leaprs:request-timeline-changed', handleTimelineChange);
    return () => window.removeEventListener('leaprs:request-timeline-changed', handleTimelineChange);
  }, [loadProgress, requestId]);

  if (steps.length === 0) return null;
  return (
    <Box aria-label="Request timeline progress" sx={{ maxWidth: '42vw', overflowX: 'auto', overflowY: 'visible', py: '5px', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', width: 'max-content', px: '5px' }}>
        {steps.map((step, index) => <ProgressNode key={`${step}-${index}`} step={step} isLast={index === steps.length - 1} />)}
      </Box>
    </Box>
  );
}
