'use client';

import TextField, { type TextFieldProps } from '@mui/material/TextField';
import AmountField from '@/components/AmountField';

export default function NumberField({ type, value, onChange, ...props }: TextFieldProps) {
  if (type !== 'number') return <TextField {...props} type={type} value={value} onChange={onChange} />;
  return <AmountField {...props} value={String(value ?? '')} onChange={onChange ?? (() => {})} />;
}
