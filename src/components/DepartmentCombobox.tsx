'use client';

import { Autocomplete, TextField } from '@mui/material';

const OTHER_DEPARTMENT = '__other_department__';

type DepartmentComboboxProps = {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  otherSelected: boolean;
  onOtherSelectedChange: (selected: boolean) => void;
  required?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium';
};

export default function DepartmentCombobox({
  options,
  value,
  onChange,
  otherSelected,
  onOtherSelectedChange,
  required = false,
  disabled = false,
  size = 'medium',
}: DepartmentComboboxProps) {
  const departments = Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  if (!otherSelected && value && !departments.includes(value)) departments.unshift(value);

  return (
    <Autocomplete
      freeSolo={otherSelected}
      forcePopupIcon
      openOnFocus
      options={[...departments, OTHER_DEPARTMENT]}
      // Keep the typed custom value as the Autocomplete value too. With `null`
      // here, MUI hides the clear control while “Not listed” is selected.
      value={value || null}
      inputValue={value}
      clearOnEscape
      disabled={disabled}
      getOptionLabel={(option) => option === OTHER_DEPARTMENT ? 'Not listed (please specify)' : option}
      onChange={(_, selected) => {
        if (selected === OTHER_DEPARTMENT) {
          onOtherSelectedChange(true);
          onChange('');
        } else if (typeof selected === 'string') {
          onOtherSelectedChange(otherSelected && !departments.includes(selected));
          onChange(selected);
        } else {
          onOtherSelectedChange(false);
          onChange('');
        }
      }}
      onInputChange={(_, input, reason) => {
        if (otherSelected && reason === 'input') onChange(input);
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          fullWidth
          required={required}
          size={size}
          label={otherSelected ? 'Department (specify)' : 'Department'}
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, readOnly: !otherSelected },
          }}
        />
      )}
    />
  );
}
