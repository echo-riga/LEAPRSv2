'use client';

import dayjs from 'dayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

type DateFieldProps = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  size?: 'small' | 'medium';
  disabled?: boolean;
  fullWidth?: boolean;
};

export default function DateField({
  label,
  value,
  onChange,
  required = false,
  size = 'medium',
  disabled = false,
  fullWidth = true,
}: DateFieldProps) {
  return (
    <DatePicker
      label={label}
      value={value ? dayjs(value) : null}
      onChange={(date) => onChange(date && date.isValid() ? date.format('YYYY-MM-DD') : '')}
      format="MM/DD/YYYY"
      disabled={disabled}
      slotProps={{
        textField: {
          fullWidth,
          required,
          size,
        },
      }}
    />
  );
}

