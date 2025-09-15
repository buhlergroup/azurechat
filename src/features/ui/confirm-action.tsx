import React, { useState } from "react";
import type { ReactNode, FC } from "react";
import { Check, X } from "lucide-react";

export type ConfirmActionProps = {
  label: string;
  loadingLabel?: string;
  icon?: ReactNode;
  confirmIcon?: ReactNode;
  cancelIcon?: ReactNode;
  onConfirm: () => void;
  onCancel?: () => void;
  loading?: boolean;
};

export const ConfirmAction: FC<ConfirmActionProps> = ({
  label,
  loadingLabel,
  icon,
  confirmIcon,
  cancelIcon,
  onConfirm,
  onCancel,
  loading,
}) => {
  const [showConfirm, setShowConfirm] = useState(false);
  if (loading) {
    return (
      <span className="px-2 py-1 rounded-[6px] text-sm border border-solid border-gray bg-background inline-flex items-center justify-center">
        {loadingLabel || "Loading..."}
      </span>
    );
  }
  return showConfirm ? (
    <div className="flex gap-1.5">
      <span
        onClick={() => setShowConfirm(false)}
        className={`px-2 py-1 rounded-[6px] text-sm border border-solid bg-background hover:bg-accent cursor-pointer inline-flex items-center justify-center`}
      >
        {icon || label}
      </span>
      <span
        onClick={onConfirm}
        className={`px-2 py-1 rounded-[6px] border border-solid bg-background hover:bg-accent cursor-pointer inline-flex items-center justify-center`}
        title={`Confirm ${label.toLowerCase()}`}
      >
        {confirmIcon || <Check size={18} color="green" />}
      </span>
      <span
        onClick={onCancel || (() => setShowConfirm(false))}
        className={`px-2 py-1 rounded-[6px] border border-solid bg-background hover:bg-accent cursor-pointer inline-flex items-center justify-center`}
        title={`Cancel ${label.toLowerCase()}`}
      >
        {cancelIcon || <X size={18} color="gray" />}
      </span>
    </div>
  ) : (
    <span
      onClick={() => setShowConfirm(true)}
      className={`px-2 py-1 rounded-[6px] text-sm border border-solid bg-background hover:bg-accent cursor-pointer hidden group-hover:inline-flex`}
    >
      {label}
    </span>
  );
};