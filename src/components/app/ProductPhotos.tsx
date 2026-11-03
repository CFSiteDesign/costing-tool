import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";

/** Drag-and-drop photos for a product (Nov 2026). Files are shrunk in the browser (hostel wifi), stored in the
 *  product-photos bucket at <location>/<product>/<name>, and listed in product_photos. The first photo is the cover. */
interface Photo { id: string; url: string; sort_order: number; caption: string | null; }
const BUCKET = "product-photos";
const MAX_SIDE = 1800;

async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not read that image"))), "image/jpeg", 0.85));
}

export function ProductPhotos({ productId, locationId, canEdit }: { productId: string; locationId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const { data: photos } = useQuery({
    queryKey: ["product-photos", productId],
    queryFn: async () => {
      const { data, error } = await supabase.from("product_photos").select("id, url, sort_order, caption").eq("product_id", productId).order("sort_order");
      if (error) throw error;
      return (data ?? []) as Photo[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["product-photos", productId] });

  const upload = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
    if (list.length === 0) { toast.error("Drop image files (JPG, PNG or WebP)"); return; }
    let next = (photos?.reduce((m, p) => Math.max(m, p.sort_order), -1) ?? -1) + 1;
    for (const f of list) {
      setBusy((n) => n + 1);
      try {
        const blob = await shrink(f);
        const path = `${locationId}/${productId}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
        if (up.error) throw up.error;
        const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        const { error } = await supabase.from("product_photos").insert({ product_id: productId, url, sort_order: next++ });
        if (error) throw error;
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message || "could not upload"}${/HEIC|HEIF/i.test(f.name) ? " (try exporting it as JPG)" : ""}`);
      } finally { setBusy((n) => n - 1); }
    }
    refresh();
  };

  const remove = async (p: Photo) => {
    if (!window.confirm("Remove this photo?")) return;
    const marker = `/${BUCKET}/`;
    const i = p.url.indexOf(marker);
    if (i >= 0) await supabase.storage.from(BUCKET).remove([decodeURIComponent(p.url.slice(i + marker.length))]);
    const { error } = await supabase.from("product_photos").delete().eq("id", p.id);
    if (error) toast.error(error.message); else refresh();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Photos</span>
        <span className="text-[11px] text-muted-foreground">{photos?.length ?? 0} · the first one is the cover</span>
      </div>
      {(photos?.length ?? 0) > 0 && (
        <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-3">
          {photos!.map((p, i) => (
            <div key={p.id} className="relative group aspect-[4/3] rounded-md overflow-hidden border bg-secondary">
              <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.2"; }} />
              {i === 0 && <span className="absolute left-1 top-1 rounded bg-black/70 text-white text-[10px] px-1.5 py-0.5">Cover</span>}
              {canEdit && (
                <button type="button" aria-label="Remove photo" onClick={() => remove(p)}
                  className="absolute right-1 top-1 h-6 w-6 grid place-items-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 max-sm:opacity-100">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
          onClick={() => input.current?.click()}
          className={`cursor-pointer rounded-md border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${over ? "border-foreground bg-secondary" : "text-muted-foreground hover:bg-secondary/50"}`}
        >
          <ImagePlus className="h-5 w-5 mx-auto mb-1" />
          {busy > 0 ? `Uploading ${busy}…` : "Drag photos here, or click to choose them"}
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
        </div>
      )}
    </div>
  );
}
