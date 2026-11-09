/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { SendHorizontal } from "lucide-react";
import React from "react";

interface SendButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const SendButton: React.FC<SendButtonProps> = (props) => {
  const { onClick, ...rest } = props;

  return (
    // `type="button"`: the composer is a `<form>`, and a default submit
    // button would make the browser submit it and reload the host page.
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className="hb-user-input--button-icon-wrapper"
    >
      <SendHorizontal />
    </button>
  );
};

export default SendButton;
