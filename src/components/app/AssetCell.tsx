import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/lib/types";
import { studioLink } from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/app/Tip";
import { toast } from "sonner";
import { Sparkles, ExternalLink, Paperclip, RefreshCw } from "lucide-react";

export interface Asset { id: string; product_id: string; url: string; stale: boolean; created_at: string; source: string; }

/** F5: one button per row. Create in STUDIO (prefilled), View when one exists, Rebuild when it's out of date. */
export function AssetCell({ product, asset, currency, canEdit }: { product: Product; asset: Asset | null; currency: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const link = studioLink(product, currency);
  const attach = useMutation({
    mutationFn: async () => {
      if (!/^https?:\/\//.test(url.trim())) throw new Error("Paste a full URL");
      const { data: me } = await supabase.auth.getUser();
      const { error } = await supabase.from("product_assets").insert({ product_id: product.id, url: url.trim(), source: "manual", created_by: me.user?.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assets"] }); qc.invalidateQueries({ queryKey: ["product-assets"] }); setUrl(""); toast.success("Asset attached"); },
    onError: (e: Error) => toast.error(e.message),
  });

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
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="Attach a finished file by URL"><Paperclip className="h-3.5 w-3.5" /></Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-2" align="end">
            <p className="text-xs text-muted-foreground">Already have the graphic? Paste its link.</p>
            <div className="flex gap-1.5">
              <Input className="h-8 text-xs" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && attach.mutate()} />
              <Button size="sm" className="h-8" disabled={attach.isPending} onClick={() => attach.mutate()}>Attach</Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
