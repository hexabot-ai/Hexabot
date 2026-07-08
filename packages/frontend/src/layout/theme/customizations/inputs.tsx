/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import { inputBaseClasses } from "@mui/material/InputBase";
import { outlinedInputClasses } from "@mui/material/OutlinedInput";
import { alpha, Components, Theme } from "@mui/material/styles";
import { toggleButtonClasses } from "@mui/material/ToggleButton";
import { toggleButtonGroupClasses } from "@mui/material/ToggleButtonGroup";

import { brand, gray } from "../themePrimitives";

const buttonsCustomizations: Components<Theme> = {
  MuiButtonBase: {
    defaultProps: {
      disableTouchRipple: true,
      disableRipple: true,
    },
    styleOverrides: {
      root: () => ({
        boxSizing: "border-box",
        transition: "all 100ms ease-in",
        "&.MuiSwitch-switchBase": {
          span: {
            boxShadow: "0 0 1px #0008 inset",
          },
        },
      }),
    },
  },
  MuiButton: {
    styleOverrides: {
      root: ({ theme }) => ({
        boxShadow: "none",
        borderRadius: (theme.vars || theme).shape.borderRadius,
        textTransform: "none",
        variants: [
          {
            props: {
              size: "small",
            },
            style: {
              height: "2.25rem",
              padding: "3px 9px",
              lineHeight: 1,
            },
          },
          {
            props: {
              size: "medium",
            },
            style: {
              height: "2.5rem", // 40px
            },
          },
          {
            props: {
              color: "primary",
              variant: "contained",
            },
            style: {
              color: "white",
              backgroundColor: brand[300],
              "&:hover": {
                backgroundColor: brand[700],
              },
              "&:active": {
                backgroundColor: brand[700],
                backgroundImage: "none",
              },
            },
          },
          {
            props: {
              color: "secondary",
              variant: "contained",
            },
            style: {
              color: "white",
              backgroundColor: brand[300],
              backgroundImage: `linear-gradient(to bottom, ${alpha(brand[400], 0.8)}, ${brand[500]})`,
              boxShadow: `inset 0 2px 0 ${alpha(brand[200], 0.2)}, inset 0 -2px 0 ${alpha(brand[700], 0.4)}`,
              border: `1px solid ${brand[500]}`,
              "&:hover": {
                // backgroundColor: brand[700],
                boxShadow: "none",
              },
              "&:active": {
                backgroundColor: brand[700],
                backgroundImage: "none",
              },
            },
          },
          {
            props: {
              variant: "outlined",
            },
            style: {
              color: (theme.vars || theme).palette.text.primary,
              border: "1px solid",
              borderColor: gray[200],
              backgroundColor: alpha(gray[50], 0.3),
              "&:hover": {
                backgroundColor: gray[100],
                borderColor: gray[300],
              },
              "&:active": {
                backgroundColor: gray[200],
              },
              ...theme.applyStyles("dark", {
                backgroundColor: gray[800],
                borderColor: gray[700],

                "&:hover": {
                  backgroundColor: gray[900],
                  borderColor: gray[600],
                },
                "&:active": {
                  backgroundColor: gray[900],
                },
              }),
            },
          },
          {
            props: {
              color: "secondary",
              variant: "outlined",
            },
            style: {
              color: brand[700],
              border: "1px solid",
              borderColor: brand[200],
              backgroundColor: brand[50],
              "&:hover": {
                backgroundColor: brand[100],
                borderColor: brand[400],
              },
              "&:active": {
                backgroundColor: alpha(brand[200], 0.7),
              },
              ...theme.applyStyles("dark", {
                color: brand[50],
                border: "1px solid",
                borderColor: brand[900],
                backgroundColor: alpha(brand[900], 0.3),
                "&:hover": {
                  borderColor: brand[700],
                  backgroundColor: alpha(brand[900], 0.6),
                },
                "&:active": {
                  backgroundColor: alpha(brand[900], 0.5),
                },
              }),
            },
          },
          {
            props: {
              variant: "text",
            },
            style: {
              color: gray[600],
              "&:hover": {
                textDecoration: "underline",
              },
              ...theme.applyStyles("dark", {
                color: gray[50],
              }),
            },
          },
          {
            props: {
              color: "secondary",
              variant: "text",
            },
            style: {
              color: brand[700],
              "&:hover": {
                backgroundColor: alpha(brand[100], 0.5),
              },
              "&:active": {
                backgroundColor: alpha(brand[200], 0.7),
              },
              ...theme.applyStyles("dark", {
                color: brand[100],
                "&:hover": {
                  backgroundColor: alpha(brand[900], 0.5),
                },
                "&:active": {
                  backgroundColor: alpha(brand[900], 0.3),
                },
              }),
            },
          },
        ],
      }),
    },
  },
  MuiToggleButtonGroup: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: "10px",
        boxShadow: `0 4px 16px ${alpha(gray[400], 0.2)}`,
        [`& .${toggleButtonGroupClasses.selected}`]: {
          color: brand[500],
        },
        ...theme.applyStyles("dark", {
          [`& .${toggleButtonGroupClasses.selected}`]: {
            color: "#fff",
          },
          boxShadow: `0 4px 16px ${alpha(brand[700], 0.5)}`,
        }),
      }),
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: ({ theme }) => ({
        padding: "6px 12px",
        textTransform: "none",
        borderRadius: "10px",
        fontWeight: 500,
        ...theme.applyStyles("dark", {
          color: gray[400],
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.5)",
          [`&.${toggleButtonClasses.selected}`]: {
            color: brand[300],
          },
        }),
      }),
    },
  },
};
const checkboxCustomizations: Components<Theme> = {
  MuiCheckbox: {
    defaultProps: {
      disableRipple: true,
      icon: (
        <CheckBoxOutlineBlankRoundedIcon
          sx={{ color: "hsla(210, 0%, 0%, 0.0)" }}
        />
      ),
      checkedIcon: <CheckRoundedIcon sx={{ height: 14, width: 14 }} />,
      indeterminateIcon: <RemoveRoundedIcon sx={{ height: 14, width: 14 }} />,
      // //Action schema
      // size: "small",
    },
    styleOverrides: {
      root: ({ theme }) => ({
        margin: 10,
        height: 16,
        width: 16,
        borderRadius: 5,
        border: "1px solid ",
        borderColor: alpha(gray[300], 0.8),
        boxShadow: "0 0 0 1.5px hsla(210, 0%, 0%, 0.04) inset",
        backgroundColor: alpha(gray[100], 0.4),
        transition: "border-color, background-color, 120ms ease-in",
        "&:hover": {
          borderColor: brand[300],
        },
        "&.Mui-focusVisible": {
          outline: `3px solid ${alpha(brand[500], 0.5)}`,
          outlineOffset: "2px",
          borderColor: brand[400],
        },
        "&.Mui-checked": {
          color: "white",
          backgroundColor: brand[500],
          borderColor: brand[500],
          boxShadow: `none`,
          "&:hover": {
            backgroundColor: brand[600],
          },
        },
        ...theme.applyStyles("dark", {
          borderColor: alpha(gray[700], 0.8),
          boxShadow: "0 0 0 1.5px hsl(210, 0%, 0%) inset",
          backgroundColor: alpha(gray[900], 0.8),
          "&:hover": {
            borderColor: brand[300],
          },
          "&.Mui-focusVisible": {
            borderColor: brand[400],
            outline: `3px solid ${alpha(brand[500], 0.5)}`,
            outlineOffset: "2px",
          },
        }),
      }),
    },
  },
};

export const inputsCustomizations: Components<Theme> = {
  ...buttonsCustomizations,
  ...checkboxCustomizations,
  MuiAutocomplete: {
    styleOverrides: {
      root: {
        "& .MuiAutocomplete-endAdornment": {
          display: "flex",
          gap: "6px",
        },
        "&[data-multiple='true']": {
          "& .MuiAutocomplete-inputRoot": {
            height: "100%",
          },
        },
      },
    },
  },
  MuiInputBase: {
    styleOverrides: {
      root: {
        border: "none",
      },
      input: {
        "&::placeholder": {
          opacity: 0.7,
          color: gray[500],
        },
      },
    },
  },
  MuiFormControl: {
    defaultProps: {
      sx: {},
    },
    styleOverrides: {
      root: ({ theme }) => ({
        width: "100%",
        "& .MuiInputLabel-root": {
          position: "relative",
          transform: "none",
          marginBottom: theme.spacing(0.5),
        },
        [`&:has(.MuiInputBase-root.${inputBaseClasses.readOnly}) .MuiInputLabel-root.Mui-focused`]:
          {
            color: (theme.vars || theme).palette.text.secondary,
          },
        "& .MuiInputLabel-root.Mui-focused.Mui-disabled": {
          color: (theme.vars || theme).palette.text.disabled,
        },
        "& .MuiOutlinedInput-notchedOutline": {
          top: 0,
          "& legend": {
            display: "none",
          },
        },
      }),
    },
  },
  MuiFormHelperText: {
    styleOverrides: {
      root: {
        marginLeft: 0,
      },
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      input: {
        padding: 0,
      },
      root: ({ theme }) => ({
        "& input:-webkit-autofill": {
          // This removes the background color by delaying the transition indefinitely
          WebkitBoxShadow: `0 0 0 100px ${theme.palette.common.white} inset!important`,
          borderRadius: 0,
        },
        '[data-mui-color-scheme="dark"] & input:-webkit-autofill': {
          WebkitBoxShadow: `0 0 0 100px ${theme.palette.common.black} inset!important`,
        },
        padding: "7px 8px",
        color: (theme.vars || theme).palette.text.primary,
        borderRadius: (theme.vars || theme).shape.borderRadius,
        borderColor: (theme.vars || theme).palette.divider,
        backgroundColor: (theme.vars || theme).palette.background.default,
        transition: "border 120ms ease-in",
        [`&.${inputBaseClasses.disabled}, &.${inputBaseClasses.readOnly}`]: {
          color: (theme.vars || theme).palette.text.secondary,
          backgroundColor: (theme.vars || theme).palette.action.hover,
        },
        [`&.${inputBaseClasses.disabled} .${outlinedInputClasses.input}, &.${inputBaseClasses.readOnly} .${outlinedInputClasses.input}`]:
          {
            color: (theme.vars || theme).palette.text.secondary,
            WebkitTextFillColor: (theme.vars || theme).palette.text.secondary,
          },
        [`&.${inputBaseClasses.disabled} .${outlinedInputClasses.notchedOutline}, &.${inputBaseClasses.readOnly} .${outlinedInputClasses.notchedOutline}`]:
          {
            borderColor: (theme.vars || theme).palette.divider,
          },
        "&:hover": {
          borderColor: gray[400],
        },
        [`&.${inputBaseClasses.disabled}:hover .${outlinedInputClasses.notchedOutline}, &.${inputBaseClasses.readOnly}:hover .${outlinedInputClasses.notchedOutline}`]:
          {
            borderColor: (theme.vars || theme).palette.divider,
          },
        [`&.${outlinedInputClasses.focused}:not(.${inputBaseClasses.disabled}):not(.${inputBaseClasses.readOnly}) .${outlinedInputClasses.notchedOutline}`]:
          {
            borderColor: brand[400],
          },
        [`&.${outlinedInputClasses.focused}.${inputBaseClasses.readOnly} .${outlinedInputClasses.notchedOutline}`]:
          {
            borderColor: (theme.vars || theme).palette.divider,
            borderWidth: 1,
          },
        [`&.${outlinedInputClasses.focused}.${inputBaseClasses.disabled} .${outlinedInputClasses.notchedOutline}`]:
          {
            borderWidth: 1,
          },
        ...theme.applyStyles("dark", {
          "&:hover": {
            borderColor: gray[500],
          },
        }),
        variants: [
          {
            props: {
              type: "text",
              multiline: false,
            },
            style: {
              height: "2.25rem",
            },
          },
          {
            props: {
              type: "password",
              multiline: false,
            },
            style: {
              height: "2.25rem",
            },
          },
        ],
      }),
      notchedOutline: {},
    },
  },
  MuiInputAdornment: {
    styleOverrides: {
      root: ({ theme }) => ({
        "& button:last-child": {
          marginRight: "-6px",
        },
        "& button": {
          width: "calc(15px + 9px)",
          height: "calc(15px + 9px)",
        },
        "& button svg": {
          minWidth: "15px",
          minHeight: "15px",
          maxWidth: "15px",
          maxHeight: "15px",
        },
        color: (theme.vars || theme).palette.grey[500],
        ...theme.applyStyles("dark", {
          color: (theme.vars || theme).palette.grey[400],
        }),
      }),
    },
  },
  MuiFormLabel: {
    styleOverrides: {
      root: ({ theme }) => ({
        typography: theme.typography.caption,
        marginBottom: 8,
        lineHeight: 1.25,
        // //Action schema
        // display: "inline-flex",
        // alignItems: "center",
        // "& .MuiFormLabel-asterisk": {
        //   order: 2,
        // },
        // "& .action-field-label-icon": {
        //   order: 3,
        // },
      }),
    },
  },
  // //Action schema
  // MuiRadio: {
  //   defaultProps: {
  //     size: "small",
  //   },
  // },
  // //Action schema
  // MuiTextField: {
  //   defaultProps: {
  //     size: "small",
  //   },
  // },
};
