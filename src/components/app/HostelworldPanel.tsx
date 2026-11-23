import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Tip } from "@/components/app/Tip";
import { Button } from "@/components/ui/button";
import { shrink } from "@/components/app/ProductPhotos";
import { toast } from "sonner";
import { Check, Download, ImagePlus, X } from "lucide-react";

/** Hostelworld Link Up box on an event or tour (migration 038, 23 Nov 2026): the exact photo the Link Up should use
 *  (its own upload, separate from the product photos) and whether someone has checked it is on Hostelworld.
 *  Saves straight away and keeps its own state, so it never resets unsaved edits in the form around it.
 *  Changing the photo goes out in the daily Hostelworld email. */
const BUCKET = "product-photos";
export const HOSTELWORLD_CATEGORIES = ["nightly_event", "mm_tour", "one_time_event", "third_party_tour"];

interface Hw { hostelworld_photo_url: string | null; on_hostelworld: boolean | null; hostelworld_checked_at: string | null; checked_by_name: string | null }

export function HostelworldPanel({ productId, locationId, canEdit }: { productId: string; locationId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = ["product-hostelworld", productId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Hw> => {
      const { data, error } = await supabase.from("products")
        .select("hostelworld_photo_url, on_hostelworld, hostelworld_checked_at, hostelworld_checked_by").eq("id", productId).single();
      if (error) throw error;
      const by = (data as { hostelworld_checked_by: string | null }).hostelworld_checked_by;
      const { data: prof } = by ? await supabase.from("profiles").select("full_name").eq("id", by).maybeSingle() : { data: null };
      return { ...(data as Omit<Hw, "checked_by_name">), checked_by_name: (prof as { full_name: string | null } | null)?.full_name ?? null };
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["hostelworld-changes"] }); };

  const pathOf = (url: string) => { const m = `/${BUCKET}/`, i = url.indexOf(m); return i >= 0 ? decodeURIComponent(url.slice(i + m.length).split("?")[0]) : null; };

  const setPhoto = async (file: File | null) => {
    setBusy(true);
    try {
      const old = data?.hostelworld_photo_url ?? null;
      let url: string | null = null;
      if (file) {
        if (!/^image\//.test(file.type)) throw new Error("Choose an image file (JPG, PNG or WebP)");
        const path = `${locationId}/${productId}/hostelworld-${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from(BUCKET).upload(path, await shrink(file), { contentType: "image/jpeg", cacheControl: "31536000" });
        if (up.error) throw up.error;
        url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase.from("products").update({ hostelworld_photo_url: url }).eq("id", productId);
      if (error) throw error;
      const oldPath = old ? pathOf(old) : null;
      if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]);
      toast.success(url ? "Hostelworld photo saved. It goes out in tomorrow's Hostelworld email." : "Hostelworld photo removed");
      refresh();
    } catch (e) { toast.error((e as Error).message || "Could not save the photo"); }
    finally { setBusy(false); }
  };

  const setListed = async (on: boolean | null) => {
    const { data: me } = await supabase.auth.getUser();
    const { error } = await supabase.from("products").update({
      on_hostelworld: on, hostelworld_checked_at: on == null ? null : new Date().toISOString(), hostelworld_checked_by: on == null ? null : me.user?.id ?? null,
    }).eq("id", productId);
    if (error) toast.error(error.message); else refresh();
  };

  const download = async () => {
    if (!data?.hostelworld_photo_url) return;
    try {
      const blob = await (await fetch(data.hostelworld_photo_url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `hostelworld-${productId.slice(0, 8)}.jpg`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch { window.open(data.hostelworld_photo_url, "_blank"); }
  };

  const photo = data?.hostelworld_photo_url;
  const checked = data?.hostelworld_checked_at ? new Date(data.hostelworld_checked_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;

  return (
    <div className="rounded-md border p-3 space-y-3" data-tour="hostelworld">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-medium">Hostelworld Link Up</div>
          <div className="text-xs text-muted-foreground">Changes to this event go to the Hostelworld team in one email a day.</div>
        </div>
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          {data?.on_hostelworld == null && <span className="text-muted-foreground">Not checked yet</span>}
          {data?.on_hostelworld === true && <span className="text-[hsl(var(--st-active))] inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> On Hostelworld{checked ? `, checked ${checked}${data.checked_by_name ? ` by ${data.checked_by_name}` : ""}` : ""}</span>}
          {data?.on_hostelworld === false && <span className="text-[hsl(var(--st-pending))]">Not on Hostelworld{checked ? `, checked ${checked}${data.checked_by_name ? ` by ${data.checked_by_name}` : ""}` : ""}</span>}
          {canEdit && data && (
            <>
              {data.on_hostelworld !== true && <Tip label="You've looked: there is a Link Up for this on Hostelworld and it matches."><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setListed(true)}>It's on Hostelworld</Button></Tip>}
              {data.on_hostelworld !== false && <Tip label="You've looked: there is no Link Up for this on Hostelworld yet."><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setListed(false)}>Not on Hostelworld</Button></Tip>}
            </>
          )}
        </div>
      </div>

      <div className="flex gap-3 items-start">
        {photo ? (
          <>
            <img src={photo} alt="Photo for Hostelworld" className="h-24 w-32 rounded object-cover border bg-secondary" />
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Photo for Hostelworld</div>
              <div className="flex gap-1.5 flex-wrap">
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={download}><Download className="h-3.5 w-3.5" /> Download</Button>
                {canEdit && <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => input.current?.click()}><ImagePlus className="h-3.5 w-3.5" /> Replace</Button>}
                {canEdit && <Button size="sm" variant="ghost" className="h-8 gap-1.5" disabled={busy} onClick={() => { if (window.confirm("Remove the Hostelworld photo?")) setPhoto(null); }}><X className="h-3.5 w-3.5" /> Remove</Button>}
              </div>
            </div>
          </>
        ) : canEdit ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) setPhoto(f); }}
            onClick={() => input.current?.click()}
            className={`flex-1 cursor-pointer rounded-md border-2 border-dashed px-4 py-4 text-center text-sm transition-colors ${over ? "border-foreground bg-secondary" : "text-muted-foreground hover:bg-secondary/50"}`}
          >
            <ImagePlus className="h-5 w-5 mx-auto mb-1" />
            {busy ? "Uploading…" : "Photo for Hostelworld: drag the exact image the Link Up should use here, or click to choose it"}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No Hostelworld photo yet.</div>
        )}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto(f); e.target.value = ""; }} />
      </div>
    </div>
  );
}
