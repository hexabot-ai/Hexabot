/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Box,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material";

export type StepOption<TValue extends string> = {
  description: string;
  label: string;
  value: TValue;
};

export type StepOptionRadioGroupProps<TValue extends string> = {
  label: string;
  value: TValue;
  options: StepOption<TValue>[];
  isOptionValue: (value: string) => value is TValue;
  onChange: (value: TValue) => void;
};

/**
 * Radio group showing each option as a bordered card with its description.
 */
export const StepOptionRadioGroup = <TValue extends string>({
  label,
  value,
  options,
  isOptionValue,
  onChange,
}: StepOptionRadioGroupProps<TValue>) => (
  <FormControl component="fieldset" fullWidth>
    <FormLabel component="legend">{label}</FormLabel>
    <RadioGroup
      value={value}
      onChange={(event) => {
        const nextValue = event.target.value;

        if (isOptionValue(nextValue)) {
          onChange(nextValue);
        }
      }}
    >
      <Stack spacing={1} mt={1}>
        {options.map((option) => (
          <Box
            key={option.value}
            border={(theme) => `1px solid ${theme.palette.divider}`}
            borderRadius={1}
            px={1}
            py={0.5}
          >
            <FormControlLabel
              value={option.value}
              control={<Radio size="small" />}
              label={option.label}
            />
            <Typography variant="body2" color="text.secondary" ml={4}>
              {option.description}
            </Typography>
          </Box>
        ))}
      </Stack>
    </RadioGroup>
  </FormControl>
);
