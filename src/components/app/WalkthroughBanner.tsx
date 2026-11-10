import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Play } from "lucide-react";

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/help`;
const VIDEO = `${BASE}/walkthrough.mp4`;
const POSTER = `${BASE}/walkthrough-poster.jpg`;

/** Pinned at the top of Experiences: the team walkthrough video (2:18). Stored in the public "help" bucket so every login, community managers included, can play it without Drive access. */
export function WalkthroughBanner() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 rounded-lg border bg-card p-2 pr-4 text-left hover:bg-secondary/60 transition-colors">
        <span className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-black">
          <img src={POSTER} alt="" className="h-full w-full object-cover" loading="lazy" />
          <span className="absolute inset-0 grid place-items-center bg-black/30 group-hover:bg-black/20">
            <Play className="h-5 w-5 fill-white text-white" />
          </span>
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Video walkthrough</span>
          <span className="block text-xs text-muted-foreground">New here? Watch how the Experience Database works (2 min 18 sec)</span>
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-3">
          <DialogHeader><DialogTitle className="text-base">Experience Database walkthrough</DialogTitle></DialogHeader>
          {open && <video src={VIDEO} poster={POSTER} controls autoPlay playsInline className="w-full rounded-md bg-black aspect-video" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
