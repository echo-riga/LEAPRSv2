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
}

interface ReorderableField {
  id?: number;
  key: string;
  sortOrder: number;
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
const VERTICAL_EDGE_ZONE = 0.28;

function getDropTarget(clientX: number, clientY: number, sourceKey: string): FieldDropTarget | null {
  const element = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>(DROP_TARGET_SELECTOR);

  const key = element?.dataset.fieldDropKey;
  if (!element || !key) return null;

  const explicitPosition = element.dataset.fieldDropPosition as DropPosition | undefined;
  const explicitEdge = element.dataset.fieldDropEdge as DropEdge | undefined;
  const explicitColumnPosition = element.dataset.fieldDropColumnPosition as 'left' | 'right' | undefined;
  if (explicitPosition && explicitEdge) {
    return { key, position: explicitPosition, edge: explicitEdge, columnPosition: explicitColumnPosition };
  }

  if (key === sourceKey) return null;

  const rect = element.getBoundingClientRect();
  const yRatio = (clientY - rect.top) / rect.height;
  const isHalfWidth = element.dataset.fieldDropWidth === 'half' && window.matchMedia('(min-width: 600px)').matches;

  // A half-width card follows visual reading order: top/bottom edges move between
  // rows, while the middle of the card uses left/right placement within the row.
  if (isHalfWidth && yRatio > VERTICAL_EDGE_ZONE && yRatio < 1 - VERTICAL_EDGE_ZONE) {
    return clientX < rect.left + rect.width / 2
      ? { key, position: 'before', edge: 'left' }
      : { key, position: 'after', edge: 'right' };
  }

  return clientY < rect.top + rect.height / 2
    ? { key, position: 'before', edge: 'top' }
    : { key, position: 'after', edge: 'bottom' };
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
    const nextColumnPosition = source.width === 'half' && target.columnPosition
      ? target.columnPosition
      : source.columnPosition;

    if (sourceKey === target.key) {
      if (!target.columnPosition || nextColumnPosition === source.columnPosition) return;
      const updated = current.map((field, index) => index === sourceIndex
        ? { ...field, columnPosition: nextColumnPosition }
        : field);
      fieldsRef.current = updated;
      setFields(updated);
      void Promise.resolve(persistOrderRef.current(updated)).catch((error) => {
        console.error('Failed to persist field layout:', error);
      });
      return;
    }

    const reordered = [...current];
    const [sourceField] = reordered.splice(sourceIndex, 1);
    const draggedField = { ...sourceField, columnPosition: nextColumnPosition };
    const targetIndex = reordered.findIndex((field) => field.key === target.key);
    if (targetIndex === -1) return;

    reordered.splice(target.position === 'before' ? targetIndex : targetIndex + 1, 0, draggedField);
    const sorted = reordered.map((field, index) => ({ ...field, sortOrder: index + 1 }));
    if (sorted.every((field, index) => field.key === current[index]?.key)) return;

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

    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const target = getDropTarget(pointerEvent.clientX, pointerEvent.clientY, sourceKey);
      setDragOverTarget((current) => (
        current?.key === target?.key &&
        current?.position === target?.position &&
        current?.edge === target?.edge
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
      activeCleanupRef.current = null;
    };

    const finish = (pointerEvent: PointerEvent) => {
      const target = getDropTarget(pointerEvent.clientX, pointerEvent.clientY, sourceKey);
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
        top: target.edge === 'top' ? -4 : target.edge === 'bottom' ? 'auto' : 0,
        bottom: target.edge === 'bottom' ? -4 : target.edge === 'top' ? 'auto' : 0,
        left: target.edge === 'left' ? -4 : target.edge === 'right' ? 'auto' : 0,
        right: target.edge === 'right' ? -4 : target.edge === 'left' ? 'auto' : 0,
        width: vertical ? 4 : 'auto',
        height: vertical ? 'auto' : 4,
        bgcolor: 'primary.main',
        borderRadius: 2,
        zIndex: 20,
        boxShadow: '0 0 8px rgba(46, 125, 50, 0.6)',
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
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 80,
        border: active ? '2px dashed #2e7d32' : '1px dashed rgba(46, 125, 50, 0.25)',
        borderRadius: 2.5,
        bgcolor: active ? 'rgba(46, 125, 50, 0.08)' : 'rgba(46, 125, 50, 0.02)',
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
      }}
    >
      <Typography variant="caption" sx={{ color: active ? 'primary.main' : 'text.secondary', fontWeight: 600 }}>
        {active ? `Drop beside ${fieldName || 'field'}` : '+ Drop field here'}
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
