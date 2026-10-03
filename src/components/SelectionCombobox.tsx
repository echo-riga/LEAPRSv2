'use client';

import { Autocomplete, TextField } from '@mui/material';

type SelectionComboboxProps = {
  options: readonly unknown[] | null | undefined;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium';
};

export default function SelectionCombobox({
  options,
  value,
  onChange,
  label,
  placeholder = 'Select an option...',
  required = false,
  disabled = false,
  size = 'medium',
}: SelectionComboboxProps) {
  const choices = (options || []).filter((option): option is string => typeof option === 'string');

  return (
    <Autocomplete
      fullWidth
      forcePopupIcon
      openOnFocus
      options={choices}
      value={value || null}
      inputValue={value}
      disabled={disabled}
      onChange={(_, selected) => onChange(selected || '')}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required={required}
          size={size}
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, readOnly: true },
          }}
        />
      )}
    />
  );
}
