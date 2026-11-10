import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { Product } from "@/lib/types";
import { studioLink } from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/app/Tip";
import { toast } from "sonner";
import { Sparkles, ExternalLink, Paperclip, RefreshCw, Upload, Loader2 } from "lucide-react";

export interface Asset { id: string; product_id: string; url: string; stale: boolean; created_at: string; source: string; }

// Nov 2026 (Lexie): uploads land in the public product-assets bucket at <location>/<product>/<name>, so every login,
// community managers included, can open them. Google Drive links only open for Mad Monkey Google accounts, so they're refused.
const BUCKET = "product-assets";
const MAX_MB = 50;
const isDrive = (u: string) => /^https?:\/\/(drive|docs)\.google\.com\//i.test(u.trim());

/** F5: one button per row. Create in STUDIO (prefilled), View when one exists, Rebuild when it's out of date. */
export function AssetCell({ product, asset, currency, canEdit }: { product: Product; asset: Asset | null; currency: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const auth = useAuth();
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const link = studioLink(product, currency, auth.allLocations.find((l) => l.id === product.location_id)?.name);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["assets"] }); qc.invalidateQueries({ queryKey: ["product-assets"] }); };
  const attach = useMutation({
    mutationFn: async () => {
      if (!/^https?:\/\//.test(url.trim())) throw new Error("Paste a full URL");
      if (isDrive(url)) throw new Error("Google Drive links don't open for the community managers. Download the file from Drive and upload it here instead.");
      const { data: me } = await supabase.auth.getUser();
      const { error } = await supabase.from("product_assets").insert({ product_id: product.id, url: url.trim(), source: "manual", created_by: me.user?.id });
      if (error) throw error;
    },
    onSuccess: () => { refresh(); setUrl(""); toast.success("Asset attached"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const upload = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    const { data: me } = await supabase.auth.getUser();
    let done = 0;
    for (const f of list) {
      if (f.size > MAX_MB * 1024 * 1024) { toast.error(`${f.name} is over ${MAX_MB} MB`); continue; }
      setUploading((n) => n + 1);
      try {
        const safe = f.name.replace(/[^\w.-]+/g, "-").slice(-80) || "asset";
        const path = `${product.location_id}/${product.id}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
        const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, cacheControl: "31536000" });
        if (up.error) throw up.error;
        const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        const { error } = await supabase.from("product_assets").insert({ product_id: product.id, url: publicUrl, source: "upload", created_by: me.user?.id });
        if (error) throw error;
        done++;
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message || "could not upload"}`);
      } finally { setUploading((n) => n - 1); }
    }
    if (fileInput.current) fileInput.current.value = "";
    if (done) { refresh(); toast.success(done === 1 ? "Asset uploaded" : `${done} assets uploaded`); }
  };

  return (
    <div className="flex items-center gap-1 whitespace-nowrap">
      {asset ? (
        <>
          <Tip label={`Made ${new Date(asset.created_at).toLocaleDateString("en-GB")}${asset.stale ? " — name, day, time or price changed since, so rebuild it" : ""}`}>
            <a href={asset.url} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className={`h-7 text-xs gap-1 ${asset.stale ? "border-[hsl(var(--st-pending))]/50 text-[hsl(var(--st-pending))]" : ""}`}>
                <ExternalLink className="h-3 w-3" /> View{asset.stale ? " · out of date" : ""}
              </Button>
            </a>
          </Tip>
          {canEdit && (
            <Tip label="Rebuild in STUDIO with the current details prefilled">
              <a href={link} target="_blank" rel="noreferrer"><Button variant="ghost" size="icon" className="h-7 w-7"><RefreshCw className="h-3.5 w-3.5" /></Button></a>
            </Tip>
          )}
        </>
      ) : canEdit ? (
        <Tip label="Opens STUDIO with the tour name, day, time, price and description already filled in. Finish and download there; the file comes back to this row.">
          <a href={link} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Sparkles className="h-3 w-3" /> Create</Button>
          </a>
        </Tip>
      ) : <span className="text-xs text-muted-foreground">—</span>}
      {canEdit && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="Upload a finished file">
              {uploading > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-2" align="end">
            <p className="text-xs text-muted-foreground">Already have the graphic or video? Upload it so everyone can open it, community managers included.</p>
            <input ref={fileInput} type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={(e) => upload(e.target.files)} />
            <Button size="sm" className="h-8 w-full gap-1.5" disabled={uploading > 0} onClick={() => fileInput.current?.click()}>
              {uploading > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading > 0 ? "Uploading…" : "Upload files"}
            </Button>
            <p className="text-[11px] text-muted-foreground">Images, videos or PDFs, up to {MAX_MB} MB each.</p>
            <div className="border-t pt-2 space-y-1.5">
              <p className="text-xs text-muted-foreground">Or paste a link (not Google Drive)</p>
              <div className="flex gap-1.5">
                <Input className="h-8 text-xs" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && attach.mutate()} />
                <Button size="sm" variant="outline" className="h-8" disabled={attach.isPending} onClick={() => attach.mutate()}>Attach</Button>
              </div>
              {isDrive(url) && <p className="text-[11px] text-destructive">Drive links don't open for the community managers. Download the file and upload it above instead.</p>}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
