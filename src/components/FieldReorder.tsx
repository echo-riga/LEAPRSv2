'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Grid, Typography } from '@mui/material';

type DropPosition = 'before' | 'after';
type DropEdge = 'top' | 'right' | 'bottom' | 'left';

export interface FieldDropTarget {
  key: string;
  position: DropPosition;
  edge: DropEdge;
  columnPosition?: 'left' | 'right';
  emptySlot?: boolean;
}

interface ReorderableField {
  id?: number;
  key: string;
  sortOrder: number;
  type: string;
  width: string;
  columnPosition?: string;
}

interface UseFieldReorderOptions<T extends ReorderableField> {
  fields: T[];
  setFields: React.Dispatch<React.SetStateAction<T[]>>;
  disabledKeys: Set<string>;
  persistOrder: (fields: T[]) => Promise<unknown> | void;
}

const DROP_TARGET_SELECTOR = '[data-field-drop-key]';

function getDropTarget(clientX: number, clientY: number, sourceKey: string): FieldDropTarget | null {
  // 1. Direct hit check with elementFromPoint
  let element = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>(DROP_TARGET_SELECTOR);

  // If directly hitting the dragged card itself (not an empty slot), or if in a grid gap/padding
  const isSelfCard = element && element.dataset.fieldDropKey === sourceKey && element.dataset.fieldEmptySlot !== 'true';
  if (!element || isSelfCard) {
    const allTargets = Array.from(document.querySelectorAll<HTMLElement>(DROP_TARGET_SELECTOR))
      .filter((el) => {
        // Exclude the card being dragged, but allow empty slots belonging to it (for flipping left/right)
        const isSelf = el.dataset.fieldDropKey === sourceKey && el.dataset.fieldEmptySlot !== 'true';
        return !isSelf;
      });

    let closestEl: HTMLElement | null = null;
    let minDistance = Infinity;

    for (const targetEl of allTargets) {
      const rect = targetEl.getBoundingClientRect();
      const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
      const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
      const dist = Math.hypot(dx, dy);

      if (dist < minDistance) {
        minDistance = dist;
        closestEl = targetEl;
      }
    }

    // Snap to the closest element within a 250px boundary
    if (closestEl && minDistance <= 250) {
      element = closestEl;
    } else if (isSelfCard || !element) {
      return null;
    }
  }

  const key = element.dataset.fieldDropKey;
  if (!key) return null;

  const explicitPosition = element.dataset.fieldDropPosition as DropPosition | undefined;
  const explicitEdge = element.dataset.fieldDropEdge as DropEdge | undefined;
  const explicitColumnPosition = element.dataset.fieldDropColumnPosition as 'left' | 'right' | undefined;
  const emptySlot = element.dataset.fieldEmptySlot === 'true';

  if (explicitPosition && explicitEdge) {
    return {
      key,
      position: explicitPosition,
      edge: explicitEdge,
      columnPosition: explicitColumnPosition,
      emptySlot,
    };
  }

  // Dropping directly onto self (as a card) is a no-op
  if (key === sourceKey) return null;

  const rect = element.getBoundingClientRect();
  const xRatio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const yRatio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  const isHalfWidth = element.dataset.fieldDropWidth === 'half' && window.matchMedia('(min-width: 600px)').matches;

  // A half-width card follows 4-quadrant placement:
  // Top / bottom 22% inserts vertically before / after
  // Middle area splits left / right for side-by-side positioning
  if (isHalfWidth) {
    if (yRatio < 0.22) {
      return { key, position: 'before', edge: 'top', columnPosition: 'left' };
    }
    if (yRatio > 0.78) {
      return { key, position: 'after', edge: 'bottom', columnPosition: 'left' };
    }
    return xRatio < 0.5
      ? { key, position: 'before', edge: 'left', columnPosition: 'left' }
      : { key, position: 'after', edge: 'right', columnPosition: 'right' };
  }

  // Full-width card: top half vs bottom half
  return yRatio < 0.5
    ? { key, position: 'before', edge: 'top', columnPosition: 'left' }
    : { key, position: 'after', edge: 'bottom', columnPosition: 'left' };
}

export function useFieldReorder<T extends ReorderableField>({
  fields,
  setFields,
  disabledKeys,
  persistOrder,
}: UseFieldReorderOptions<T>) {
  const [draggedFieldKey, setDraggedFieldKey] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<FieldDropTarget | null>(null);
  const fieldsRef = useRef(fields);
  const disabledKeysRef = useRef(disabledKeys);
  const persistOrderRef = useRef(persistOrder);
  const activeCleanupRef = useRef<(() => void) | null>(null);
  const latestTargetRef = useRef<FieldDropTarget | null>(null);

  useEffect(() => {
    fieldsRef.current = fields;
    disabledKeysRef.current = disabledKeys;
    persistOrderRef.current = persistOrder;
  }, [disabledKeys, fields, persistOrder]);

  useEffect(() => () => activeCleanupRef.current?.(), []);

  const commitMove = useCallback((sourceKey: string, target: FieldDropTarget) => {
    const current = fieldsRef.current;
    const sourceIndex = current.findIndex((field) => field.key === sourceKey);
    if (sourceIndex === -1) return;

    const source = current[sourceIndex];

    // Dropping on own empty slot (e.g. flipping a single 50% field between left and right column)
    if (sourceKey === target.key) {
      if (source.width === 'half' && target.columnPosition && source.columnPosition !== target.columnPosition) {
        const updated = current.map((field, index) =>
          index === sourceIndex ? { ...field, columnPosition: target.columnPosition } : field
        );
        fieldsRef.current = updated;
        setFields(updated);
        void Promise.resolve(persistOrderRef.current(updated)).catch((error) => {
          console.error('Failed to persist field layout:', error);
        });
      }
      return;
    }

    // Absolute Priority Move:
    // Extract the dragged field and insert it directly at the target position.
    const reordered = [...current];
    const [sourceField] = reordered.splice(sourceIndex, 1);

    const targetIndex = reordered.findIndex((field) => field.key === target.key);
    if (targetIndex === -1) return;

    // Determine new columnPosition for half-width fields
    let nextColumnPosition: string | undefined = sourceField.columnPosition;
    if (sourceField.width === 'half') {
      if (target.columnPosition) {
        nextColumnPosition = target.columnPosition;
      } else if (target.position === 'before' && (target.edge === 'left' || target.edge === 'top')) {
        nextColumnPosition = 'left';
      } else if (target.position === 'after' && target.edge === 'right') {
        nextColumnPosition = 'right';
      } else {
        nextColumnPosition = 'left';
      }
    } else {
      nextColumnPosition = 'left';
    }

    const draggedField = { ...sourceField, columnPosition: nextColumnPosition };
    const insertIndex = target.position === 'before' ? targetIndex : targetIndex + 1;

    reordered.splice(insertIndex, 0, draggedField);

    const sorted = reordered.map((field, index) => ({
      ...field,
      sortOrder: index + 1,
    }));

    const isUnchanged = sorted.every((field, index) => (
      field.key === current[index]?.key &&
      field.width === current[index]?.width &&
      field.columnPosition === current[index]?.columnPosition
    ));

    if (isUnchanged) return;

    fieldsRef.current = sorted;
    setFields(sorted);
    void Promise.resolve(persistOrderRef.current(sorted)).catch((error) => {
      console.error('Failed to persist field order:', error);
    });
  }, [setFields]);

  const handlePointerDragStart = useCallback((event: React.PointerEvent<HTMLElement>, sourceKey: string) => {
    if (event.button !== 0 || disabledKeysRef.current.has(sourceKey)) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    setDraggedFieldKey(sourceKey);
    latestTargetRef.current = null;

    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const target = getDropTarget(pointerEvent.clientX, pointerEvent.clientY, sourceKey);
      latestTargetRef.current = target;
      setDragOverTarget((current) => (
        current?.key === target?.key &&
        current?.position === target?.position &&
        current?.edge === target?.edge &&
        current?.columnPosition === target?.columnPosition &&
        current?.emptySlot === target?.emptySlot
          ? current
          : target
      ));

      const scrollZone = 72;
      if (pointerEvent.clientY < scrollZone) window.scrollBy({ top: -16 });
      if (pointerEvent.clientY > window.innerHeight - scrollZone) window.scrollBy({ top: 16 });
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', cancel);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setDraggedFieldKey(null);
      setDragOverTarget(null);
      latestTargetRef.current = null;
      activeCleanupRef.current = null;
    };

    const finish = (pointerEvent: PointerEvent) => {
      const target = getDropTarget(pointerEvent.clientX, pointerEvent.clientY, sourceKey) || latestTargetRef.current;
      if (target) commitMove(sourceKey, target);
      cleanup();
    };

    const cancel = () => cleanup();
    activeCleanupRef.current?.();
    activeCleanupRef.current = cleanup;
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', cancel);
  }, [commitMove]);

  const handleKeyboardMove = useCallback((event: React.KeyboardEvent<HTMLElement>, sourceKey: string) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = fieldsRef.current;
    const sourceIndex = current.findIndex((field) => field.key === sourceKey);
    const moveBackward = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const target = current[sourceIndex + (moveBackward ? -1 : 1)];
    if (sourceIndex === -1 || !target) return;
    commitMove(sourceKey, {
      key: target.key,
      position: moveBackward ? 'before' : 'after',
      edge: moveBackward ? 'top' : 'bottom',
    });
  }, [commitMove]);

  return { draggedFieldKey, dragOverTarget, handlePointerDragStart, handleKeyboardMove };
}

export function FieldDropIndicator({ target }: { target: FieldDropTarget }) {
  const vertical = target.edge === 'left' || target.edge === 'right';

  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        top: target.edge === 'top' ? -3 : target.edge === 'bottom' ? 'auto' : 0,
        bottom: target.edge === 'bottom' ? -3 : target.edge === 'top' ? 'auto' : 0,
        left: target.edge === 'left' ? -3 : target.edge === 'right' ? 'auto' : 0,
        right: target.edge === 'right' ? -3 : target.edge === 'left' ? 'auto' : 0,
        width: vertical ? 5 : '100%',
        height: vertical ? '100%' : 5,
        bgcolor: '#2e7d32',
        borderRadius: 2,
        zIndex: 30,
        boxShadow: '0 0 12px rgba(46, 125, 50, 0.85)',
        pointerEvents: 'none',
      }}
    />
  );
}

export function EmptyHalfFieldDropSlot({
  fieldKey,
  fieldName,
  side,
  active,
}: {
  fieldKey: string;
  fieldName: string;
  side: 'left' | 'right';
  active: boolean;
}) {
  return (
    <Grid
      size={{ xs: 12, sm: 6 }}
      data-field-drop-key={fieldKey}
      data-field-drop-position={side === 'left' ? 'before' : 'after'}
      data-field-drop-edge={side}
      data-field-drop-column-position={side}
      data-field-empty-slot="true"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 84,
        border: active ? '2px dashed #2e7d32' : '1.5px dashed rgba(46, 125, 50, 0.25)',
        borderRadius: 2.5,
        bgcolor: active ? 'rgba(46, 125, 50, 0.12)' : 'rgba(46, 125, 50, 0.02)',
        transform: active ? 'scale(1.01)' : 'none',
        boxShadow: active ? '0 0 12px rgba(46, 125, 50, 0.2)' : 'none',
        transition: 'border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <Typography variant="caption" sx={{ color: active ? 'primary.main' : 'text.secondary', fontWeight: 600 }}>
        {active ? `Drop beside ${fieldName || 'field'}` : '+ Empty 50% slot (drop here)'}
      </Typography>
    </Grid>
  );
}

export function getHalfFieldLayout<K extends string | number>(
  fields: Array<{ key: K; width: string; type: string; columnPosition?: string }>
) {
  const before = new Set<K>();
  const after = new Set<K>();
  let pendingHalfKey: K | null = null;

  fields.forEach((field) => {
    if (field.width === 'half' && field.type !== 'table') {
      if (pendingHalfKey !== null) {
        pendingHalfKey = null;
      } else if (field.columnPosition === 'right') {
        before.add(field.key);
      } else {
        pendingHalfKey = field.key;
      }
      return;
    }
    if (pendingHalfKey !== null) after.add(pendingHalfKey);
    pendingHalfKey = null;
  });

  if (pendingHalfKey !== null) after.add(pendingHalfKey);
  return { before, after };
}
