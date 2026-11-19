import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  children,
  nested = false,
  deep = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  children?: ReactNode;
  nested?: boolean;
  deep?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        overlayClassName={deep ? "z-[80] md:top-16 lg:left-72" : nested ? "z-[60] md:top-16 lg:left-72" : undefined}
        className={`border-primary/20 bg-popover ${nested ? "z-[70]" : ""} ${deep ? "z-[90]" : ""}`}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl">{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription asChild>
              <div>{description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel className="h-9 px-3 text-sm">Cancel</AlertDialogCancel>
          <AlertDialogAction className="h-9 px-3 text-sm" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
