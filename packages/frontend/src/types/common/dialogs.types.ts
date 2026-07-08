/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ButtonProps, DialogProps as MuiDialogProps } from "@mui/material";
import { BaseSyntheticEvent, ComponentType } from "react";

interface DialogExtraOptions {
  mode?: "click" | "selection";
  count?: number;
  maxWidth?: MuiDialogProps["maxWidth"];
  hasButtons?: boolean;
  isSingleton?: boolean;
}
// context
export interface OpenDialogOptions<R> extends DialogExtraOptions {
  /**
   * A function that is called before closing the dialog closes. The dialog
   * stays open as long as the returned promise is not resolved. Use this if
   * you want to perform an async action on close and show a loading state.
   *
   * @param result The result that the dialog will return after closing.
   * @returns A promise that resolves when the dialog can be closed.
   */
  onClose?: (result: R) => Promise<void>;

  onSubmit?: (e: BaseSyntheticEvent) => void;
}

/**
 * The props that are passed to a dialog component.
 */
export interface DialogProps<P = undefined, R = void> {
  /**
   * The payload that was passed when the dialog was opened.
   */
  payload: P;
  /**
   * Whether the dialog is open.
   */
  open: boolean;
  /**
   * A function to call when the dialog should be closed. If the dialog has a return
   * value, it should be passed as an argument to this function. You should use the promise
   * that is returned to show a loading state while the dialog is performing async actions
   * on close.
   * @param result The result to return from the dialog.
   * @returns A promise that resolves when the dialog can be fully closed.
   */
  onClose: (result: R) => Promise<void>;

  onSubmit?: (e: BaseSyntheticEvent) => void;
}

export type DialogComponent<P, R> = ComponentType<DialogProps<P, R>>;

export interface OpenDialog {
  /**
   * Open a dialog without payload.
   * @param Component The dialog component to open.
   * @param options Additional options for the dialog.
   */
  <P extends undefined, R>(
    Component: DialogComponent<P, R>,
    payload?: P,
    options?: OpenDialogOptions<R>,
  ): Promise<R>;
  /**
   * Open a dialog and pass a payload.
   * @param Component The dialog component to open.
   * @param payload The payload to pass to the dialog.
   * @param options Additional options for the dialog.
   */
  <P, R>(
    Component: DialogComponent<P, R>,
    payload: P,
    options?: OpenDialogOptions<R>,
  ): Promise<R>;
}

export interface CloseDialog {
  /**
   * Close a dialog and return a result.
   * @param dialog The dialog to close. The promise returned by `open`.
   * @param result The result to return from the dialog.
   * @returns A promise that resolves when the dialog is fully closed.
   */
  <R>(dialog: Promise<R>, result: R): Promise<R>;
}

export interface ConfirmOptions extends OpenDialogOptions<boolean> {
  /**
   * A title for the dialog. Defaults to `'Confirm'`.
   */
  title?: React.ReactNode;
  /**
   * The text to show in the "Ok" button. Defaults to `'Ok'`.
   */
  okText?: React.ReactNode;
  /**
   * Denotes the purpose of the dialog. This will affect the color of the
   * "Ok" button. Defaults to `undefined`.
   */
  severity?: "error" | "info" | "success" | "warning";
  /**
   * The text to show in the "Cancel" button. Defaults to `'Cancel'`.
   */
  cancelText?: React.ReactNode;
}

export interface OpenConfirmDialog {
  /**
   * Open a confirmation dialog. Returns a promise that resolves to true if
   * the user confirms, false if the user cancels.
   *
   * @param msg The message to show in the dialog.
   * @param options Additional options for the dialog.
   * @returns A promise that resolves to true if the user confirms, false if the user cancels.
   */
  (msg: ComponentType, options?: ConfirmOptions): Promise<boolean>;
}

export interface DialogStackEntry<P, R> {
  key: string;
  open: boolean;
  promise: Promise<R>;
  Component: DialogComponent<P, R>;
  payload: P;
  onClose: (result: R) => Promise<void>;
  resolve: (result: R) => void;
  msgProps: DialogExtraOptions;
}

export interface DialogProviderProps {
  children?: React.ReactNode;
  unmountAfter?: number;
}

// form dialog
export interface FormDialogProps
  extends FormButtonsProps,
    Omit<MuiDialogProps, "onSubmit" | "open">,
    DialogExtraOptions {
  open?: boolean;
  title?: string;
  children?: React.ReactNode;
}

// form
export interface FormButtonsProps {
  onSubmit?: (e: BaseSyntheticEvent) => void;
  onCancel?: () => void;
  cancelButtonProps?: ButtonProps & { text?: string };
  confirmButtonProps?: ButtonProps & { text?: string };
}

export type TPayload<D, P = unknown> = {
  presetValues?: P;
  defaultValues?: D | null;
};

export type ComponentFormProps<D, P = unknown> = FormButtonsProps & {
  data: TPayload<D, P>;
  onError?: () => void;
  onSuccess?: (data?: D) => void;
  Wrapper?: React.FC<FormDialogProps>;
  WrapperProps?: Partial<FormDialogProps> & Partial<FormButtonsProps>;
};

export type ExtractFormProps<T extends (arg: { data: any }) => unknown> =
  Parameters<T>[0]["data"];

export type ComponentFormDialogProps<
  T extends (arg: { data: any }) => unknown,
> = FormButtonsProps &
  DialogProps<
    ExtractFormProps<T>,
    boolean | NonNullable<ExtractFormProps<T>["defaultValues"]>
  >;
