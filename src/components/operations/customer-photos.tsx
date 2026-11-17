"use client";
import { Camera } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { PhotosPanel } from "./photos-panel";

/** Customer photo library toggle (photos taken before a bid, plus every project's photos). */
export function CustomerPhotos({ customerId, name }: { customerId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}><Camera className="h-4 w-4" aria-hidden /> {open ? "Hide photos" : "Photos"}</Button>
      {open && <div className="mt-3" aria-label={`Photos for ${name}`}><PhotosPanel customerId={customerId} /></div>}
    </div>
  );
}
