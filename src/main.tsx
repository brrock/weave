import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";
import { WorkflowEditor } from "@/components/weave-demo/workflow-editor";

document.documentElement.classList.toggle("dark", matchMedia("(prefers-color-scheme: dark)").matches);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <WorkflowEditor />
    </TooltipProvider>
  </StrictMode>,
);
