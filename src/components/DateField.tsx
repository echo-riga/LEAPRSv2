'use client';

import dayjs from 'dayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

type DateFieldProps = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  size?: 'small' | 'medium';
};

export default function DateField({ label, value, onChange, required = false, size = 'medium' }: DateFieldProps) {
  return (
    <DatePicker
      label={label}
      value={value ? dayjs(value) : null}
      onChange={(date) => onChange(date?.isValid() ? date.format('YYYY-MM-DD') : '')}
      format="MM/DD/YYYY"
      slotProps={{ textField: { fullWidth: true, required, size } }}
    />
  );
}
