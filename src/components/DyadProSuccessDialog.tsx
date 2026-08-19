import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bot, Zap } from "lucide-react";

interface Agent2SuccessDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DyadProSuccessDialog({
  isOpen,
  onClose,
}: Agent2SuccessDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <span>Agent2 Mode Active</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            All Agent2 features are now enabled. Your AI model uses your own API
            keys — no cloud subscription needed.
          </p>
          <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3">
            <Zap className="h-4 w-4 text-primary" />
            <span>
              <strong>Features enabled:</strong> Turbo Edits, Smart Context, Web
              Access, and all 104+ agent tools.
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Get Started</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
