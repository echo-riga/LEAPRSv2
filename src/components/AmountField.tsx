'use client';

import TextField, { type TextFieldProps } from '@mui/material/TextField';
import { formatAmountInput, parseAmountInput } from '@/lib/amount-format';

type AmountFieldProps = Omit<TextFieldProps, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: NonNullable<TextFieldProps['onChange']>;
};

export default function AmountField({ value, onChange, slotProps, ...props }: AmountFieldProps) {
  return <TextField {...props} type="text" value={formatAmountInput(value)}
    slotProps={{ ...slotProps, htmlInput: { inputMode: 'numeric', ...slotProps?.htmlInput } }}
    onChange={(event) => {
      const amount = parseAmountInput(event.target.value);
      if (amount === null) return;
      const input = event.target;
      const digitsBeforeCaret = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
      onChange({ ...event, target: { ...event.target, value: amount } });
      requestAnimationFrame(() => {
        if (document.activeElement !== input) return;
        let position = 0;
        let digits = 0;
        while (position < input.value.length && digits < digitsBeforeCaret) {
          if (/\d/.test(input.value[position])) digits += 1;
          position += 1;
        }
        input.setSelectionRange(position, position);
      });
    }} />;
}
