"use client";

import { useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { hydrateStore, useGetmanStore, addTab, setCommandPaletteOpen } from "@/lib/getman-store";
import { GetmanHeader } from "./getman-header";
import { RequestBar } from "./request-bar";

const GetmanSidebar = dynamic(
  () => import("./getman-sidebar").then((mod) => mod.GetmanSidebar),
  { ssr: false }
);
const RequestEditor = dynamic(
  () => import("./request-editor").then((mod) => mod.RequestEditor),
  { ssr: false }
);
const ResponseViewer = dynamic(
  () => import("./response-viewer").then((mod) => mod.ResponseViewer),
  { ssr: false }
);
const SaveRequestDialog = dynamic(
  () => import("./save-request-dialog").then((mod) => mod.SaveRequestDialog),
  { ssr: false }
);
const OPEN_SAVE_REQUEST_DIALOG_EVENT = "getman:open-save-request-dialog";

export function GetmanApp() {
  const { sidebarOpen } = useGetmanStore();

  useEffect(() => {
    void hydrateStore();
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();

    if (key === "k") {
      e.preventDefault();
      setCommandPaletteOpen(true);
    } else if (key === "n") {
      e.preventDefault();
      addTab();
    } else if (key === "s") {
      e.preventDefault();
      window.dispatchEvent(new Event(OPEN_SAVE_REQUEST_DIALOG_EVENT));
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      <GetmanHeader />
      <SaveRequestDialog showTrigger={false} />

      <div className="flex flex-1 min-h-0">
        <div className="h-full w-full overflow-hidden border border-border bg-[hsl(var(--surface-1))]">
          <ResizablePanelGroup direction="horizontal">
            {sidebarOpen && (
              <>
                <ResizablePanel
                  defaultSize={20}
                  minSize={15}
                  maxSize={30}
                  className="border-r border-border/80"
                >
                  <GetmanSidebar />
                </ResizablePanel>
                <ResizableHandle className="w-px bg-border/70 hover:bg-primary/50 transition-colors" />
              </>
            )}

            <ResizablePanel defaultSize={sidebarOpen ? 80 : 100}>
              <div className="flex h-full flex-col">
                <div className="flex-1 min-h-0">
                  <ResizablePanelGroup direction="vertical">
                    {/* Request Section */}
                    <ResizablePanel defaultSize={45} minSize={25}>
                      <div className="flex h-full flex-col">
                        <div className="p-3 shrink-0">
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <RequestBar />
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 min-h-0 border-b border-border/70">
                          <RequestEditor />
                        </div>
                      </div>
                    </ResizablePanel>

                    <ResizableHandle className="h-px bg-border/70 hover:bg-primary/50 transition-colors" />

                    {/* Response Section */}
                    <ResizablePanel defaultSize={55} minSize={20}>
                      <ResponseViewer />
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </div>
  );
}
