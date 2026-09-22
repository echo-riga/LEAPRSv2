'use client';

import React from 'react';
import {
  Box,
  Typography,
  Stack,
  Button,
  Table,
  TableBody,
  TableCell,
  TableRow,
  InputBase,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

export function parseTableData(val: unknown, template?: unknown, defaultRows = 7, defaultCols = 5): string[][] {
  if (Array.isArray(val) && val.length > 0 && Array.isArray(val[0])) {
    return val.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []));
  }
  if (typeof val === 'string' && val.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
        return parsed.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []));
      }
    } catch {}
  }
  if (template) {
    if (Array.isArray(template) && template.length > 0 && Array.isArray(template[0])) {
      return template.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []));
    }
    if (typeof template === 'string' && template.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(template);
        if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
          return parsed.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []));
        }
      } catch {}
    }
  }
  return Array.from({ length: defaultRows }, () => Array(defaultCols).fill(''));
}

type DynamicTableFieldProps = {
  label: string;
  value: unknown;
  template?: unknown;
  onChange?: (val: string[][]) => void;
  disabled?: boolean;
  required?: boolean;
  showDimensionControls?: boolean;
};

export default function DynamicTableField({
  label,
  value,
  template,
  onChange,
  disabled = false,
  required = false,
  showDimensionControls = false,
}: DynamicTableFieldProps) {
  const tableData = parseTableData(value, template, 7, 5);

  const updateCell = (rowIndex: number, colIndex: number, text: string) => {
    if (disabled || !onChange) return;
    const newData = tableData.map((row, rIdx) =>
      rIdx === rowIndex ? row.map((cell, cIdx) => (cIdx === colIndex ? text : cell)) : [...row]
    );
    onChange(newData);
  };

  const addRow = () => {
    if (disabled || !onChange) return;
    const colCount = tableData[0]?.length || 5;
    onChange([...tableData, Array(colCount).fill('')]);
  };

  const removeRow = () => {
    if (disabled || !onChange || tableData.length <= 1) return;
    onChange(tableData.slice(0, -1));
  };

  const addColumn = () => {
    if (disabled || !onChange) return;
    onChange(tableData.map((row) => [...row, '']));
  };

  const removeColumn = () => {
    if (disabled || !onChange || (tableData[0]?.length || 0) <= 1) return;
    onChange(tableData.map((row) => row.slice(0, -1)));
  };

  const colCount = tableData[0]?.length || 0;

  return (
    <Box sx={{ width: '100%', my: 1 }}>
      {label && (
        <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary', mb: 1 }}>
          {label} {required && <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>*</span>}
        </Typography>
      )}

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        {/* Table Container */}
        <Box
          sx={{
            flexGrow: 1,
            overflowX: 'auto',
            border: '1px solid',
            borderColor: disabled ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.12)',
            borderRadius: 2,
            bgcolor: disabled ? '#fafcfa' : '#ffffff',
          }}
        >
          <Table size="small" sx={{ minWidth: 320, borderCollapse: 'collapse' }}>
            <TableBody>
              {tableData.map((row, rIdx) => (
                <TableRow key={rIdx} sx={{ '&:last-child td': { borderBottom: 'none' } }}>
                  {row.map((cell, cIdx) => (
                    <TableCell
                      key={cIdx}
                      sx={{
                        p: 0.5,
                        verticalAlign: 'top',
                        borderRight: cIdx < row.length - 1 ? '1px solid rgba(0, 0, 0, 0.08)' : 'none',
                        borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
                        minWidth: 80,
                      }}
                    >
                      {disabled ? (
                        <Typography
                          variant="body2"
                          sx={{
                            px: 1,
                            py: 0.5,
                            color: cell ? 'text.primary' : 'text.disabled',
                            fontWeight: cell ? 500 : 400,
                            minHeight: 28,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            lineHeight: 1.4,
                          }}
                        >
                          {cell || '—'}
                        </Typography>
                      ) : (
                        <InputBase
                          multiline
                          minRows={1}
                          value={cell}
                          onChange={(e) => updateCell(rIdx, cIdx, e.target.value)}
                          fullWidth
                          sx={{
                            fontSize: '0.875rem',
                            color: 'text.primary',
                            px: 1,
                            py: 0.5,
                            borderRadius: 1,
                            transition: 'all 0.15s',
                            '&:hover': { bgcolor: 'rgba(46, 125, 50, 0.04)' },
                            '&.Mui-focused': { bgcolor: 'rgba(46, 125, 50, 0.08)' },
                            '& .MuiInputBase-input': {
                              p: 0,
                              lineHeight: 1.4,
                            },
                          }}
                        />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>

        {/* Dynamic Column Add/Remove Buttons (Right Side) — only shown in config before save */}
        {showDimensionControls && !disabled && (
          <Stack spacing={0.75} sx={{ pt: 0.5, flexShrink: 0 }}>
            <Tooltip title="Add column">
              <Button
                variant="outlined"
                size="small"
                color="primary"
                onClick={addColumn}
                startIcon={<AddIcon sx={{ fontSize: 14 }} />}
                sx={{
                  minWidth: 72,
                  height: 30,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'none',
                  px: 1,
                }}
              >
                Col
              </Button>
            </Tooltip>
            <Tooltip title="Remove last column">
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  color="inherit"
                  onClick={removeColumn}
                  disabled={colCount <= 1}
                  startIcon={<RemoveIcon sx={{ fontSize: 14 }} />}
                  sx={{
                    minWidth: 72,
                    height: 30,
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textTransform: 'none',
                    px: 1,
                  }}
                >
                  Col
                </Button>
              </span>
            </Tooltip>
          </Stack>
        )}
      </Stack>

      {/* Dynamic Row Add/Remove Buttons (Below Table) — only shown in config before save */}
      {showDimensionControls && !disabled && (
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            color="primary"
            onClick={addRow}
            startIcon={<AddIcon sx={{ fontSize: 14 }} />}
            sx={{
              height: 28,
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'none',
              px: 1.25,
            }}
          >
            Row
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            onClick={removeRow}
            disabled={tableData.length <= 1}
            startIcon={<RemoveIcon sx={{ fontSize: 14 }} />}
            sx={{
              height: 28,
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'none',
              px: 1.25,
            }}
          >
            Row
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1, fontWeight: 500 }}>
            {tableData.length} × {colCount}
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
