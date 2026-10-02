import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/** Asks before Reset reboots the machine's controller. */
export function ResetMachineDialog({
  open,
  onOpenChange,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReset: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset the machine?</AlertDialogTitle>
          <AlertDialogDescription>
            Its controller restarts, which takes a few seconds and stops
            anything it is doing. OpenSpindle connects to it again once it is
            back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onOpenChange(false)
              onReset()
            }}
          >
            Reset
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
