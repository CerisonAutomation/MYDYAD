import { ArrowLeft } from "lucide-react";

interface AnnotatorOnlyForProProps {
  onGoBack: () => void;
}

export const AnnotatorOnlyForPro = ({ onGoBack }: AnnotatorOnlyForProProps) => {
  return (
    <div className="w-full h-full bg-background relative">
      <button
        onClick={onGoBack}
        className="absolute top-4 left-4 p-2 hover:bg-accent rounded-md transition-all z-10 group"
        aria-label="Go back"
      >
        <ArrowLeft
          size={20}
          className="text-foreground/70 group-hover:text-foreground transition-colors"
        />
      </button>
      <div className="flex flex-col items-center justify-center h-full px-8">
        <p className="text-muted-foreground text-center max-w-md text-base">
          Annotator is available. Select a preview to start annotating.
        </p>
      </div>
    </div>
  );
};
