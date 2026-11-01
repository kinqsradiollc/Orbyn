import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, SelectBox, ErrorNotice } from "../../ui/kit";
import { download, useExit, useOwner } from "./shared";
type Crop = {
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  quarter: number;
};
const initial: Crop = {
  width: 1200,
  height: 630,
  zoom: 1,
  panX: 0,
  panY: 0,
  quarter: 0,
};
export function ImageEditor({
  image,
  disabled,
  onApply,
  onStagedChange,
}: {
  image: string | null;
  disabled: boolean;
  onApply: (value: string | null) => void;
  onStagedChange: (staged: boolean) => void;
}) {
  const owned = useOwner(),
    canvas = useRef<HTMLCanvasElement>(null),
    ticket = useRef(0),
    locked = useRef(false),
    [source, setSource] = useState<HTMLImageElement | null>(null),
    [crop, setCrop] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useExit({ dirty: !!source, pending: busy });
  useEffect(() => {
    onStagedChange(!!source || busy);
  }, [source, busy, onStagedChange]);
  useEffect(
    () => () => {
      ticket.current++;
    },
    [],
  );
  async function load(file: File) {
    if (disabled || locked.current || !owned()) return;
    locked.current = true;
    setBusy(true);
    setError("");
    const mine = ++ticket.current;
    let url = "";
    try {
      if (
        file.size > 12000000 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw new Error("Choose a PNG, JPEG or WebP image under 12 MB.");
      url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      if (img.naturalWidth * img.naturalHeight > 40000000)
        throw new Error("Choose an image under 40 megapixels.");
      if (owned() && mine === ticket.current) {
        setSource(img);
        setCrop(initial);
      }
    } catch (e) {
      if (owned() && mine === ticket.current)
        setError(e instanceof Error ? e.message : "Could not open image.");
    } finally {
      if (url) URL.revokeObjectURL(url);
      locked.current = false;
      if (owned() && mine === ticket.current) setBusy(false);
    }
  }
  useEffect(() => {
    const node = canvas.current;
    if (!node || !source) return;
    const context = node.getContext("2d");
    if (!context) {
      setError("Canvas image editing is unavailable in this browser.");
      return;
    }
    node.width = crop.width;
    node.height = crop.height;
    const rotated = crop.quarter % 2 !== 0,
      w = rotated ? source.naturalHeight : source.naturalWidth,
      h = rotated ? source.naturalWidth : source.naturalHeight,
      scale = Math.max(crop.width / w, crop.height / h) * crop.zoom;
    context.clearRect(0, 0, node.width, node.height);
    context.save();
    context.translate(
      crop.width / 2 + ((w * scale - crop.width) * crop.panX) / 2,
      crop.height / 2 + ((h * scale - crop.height) * crop.panY) / 2,
    );
    context.rotate((crop.quarter * Math.PI) / 2);
    context.scale(scale, scale);
    context.drawImage(
      source,
      -source.naturalWidth / 2,
      -source.naturalHeight / 2,
    );
    context.restore();
  }, [source, crop]);
  function apply() {
    if (disabled || busy || !owned()) return;
    try {
      const data = canvas.current?.toDataURL("image/png");
      if (!data || data.length > 2700000)
        throw new Error(
          "The edited PNG exceeds the safe upload size. Choose a simpler or smaller source.",
        );
      onApply(data);
      setSource(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare PNG.");
    }
  }
  function brand() {
    if (disabled || locked.current || !owned()) return;
    const node = document.createElement("canvas");
    node.width = 1200;
    node.height = 630;
    const c = node.getContext("2d");
    if (!c) {
      setError("Canvas is unavailable.");
      return;
    }
    const style = getComputedStyle(document.documentElement);
    c.fillStyle = style.getPropertyValue("--canvas").trim() || "#17181b";
    c.fillRect(0, 0, 1200, 630);
    c.fillStyle = style.getPropertyValue("--text").trim() || "#ffffff";
    c.font = "64px sans-serif";
    c.fillText("Orbyn", 90, 180);
    c.font = "32px sans-serif";
    c.fillText("Plan your day. Make room for what matters.", 90, 280);
    const data = node.toDataURL("image/png");
    onApply(data);
    setSource(null);
  }
  return (
    <section className="admin-image-editor">
      <h4>Image</h4>
      <Field label="Choose local image">
        <Input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void load(file);
          }}
        />
      </Field>
      <div className="admin-actions">
        <Button disabled={disabled || busy} onClick={brand}>
          Create Orbyn brand image
        </Button>
        {image && (
          <>
            <Button
              disabled={disabled || busy}
              onClick={() => {
                if (owned()) {
                  onApply(null);
                  setSource(null);
                }
              }}
            >
              Remove image
            </Button>
            <Button
              disabled={disabled || busy}
              onClick={() => {
                if (!owned()) return;
                const binary = atob(image.split(",")[1] || "");
                download(
                  new Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))], {
                    type: "image/png",
                  }),
                  "orbyn-update.png",
                );
              }}
            >
              Download image
            </Button>
          </>
        )}
      </div>
      {source ? (
        <>
          <canvas
            ref={canvas}
            className="admin-image"
            aria-label="Edited image preview"
          />
          <Field label="Output size">
            <SelectBox
              disabled={disabled || busy}
              value={`${crop.width}x${crop.height}`}
              onChange={(e) => {
                const [width, height] = e.target.value.split("x").map(Number);
                setCrop({ ...crop, width, height });
              }}
            >
              <option value="1200x630">Wide · 1200 × 630</option>
              <option value="1200x1200">Square · 1200 × 1200</option>
              <option value="1200x1500">Portrait · 1200 × 1500</option>
            </SelectBox>
          </Field>
          {(
            [
              { key: "zoom", label: "Zoom", min: 1, max: 3, step: 0.01 },
              {
                key: "panX",
                label: "Horizontal crop",
                min: -1,
                max: 1,
                step: 0.01,
              },
              {
                key: "panY",
                label: "Vertical crop",
                min: -1,
                max: 1,
                step: 0.01,
              },
            ] as const
          ).map((c) => (
            <Field key={c.key} label={c.label}>
              <Input
                type="range"
                min={c.min}
                max={c.max}
                step={c.step}
                value={crop[c.key]}
                disabled={disabled || busy}
                onChange={(e) =>
                  setCrop({ ...crop, [c.key]: Number(e.target.value) })
                }
              />
            </Field>
          ))}
          <div className="admin-actions">
            <Button
              disabled={disabled || busy}
              onClick={() =>
                setCrop({ ...crop, quarter: (crop.quarter + 1) % 4 })
              }
            >
              Rotate clockwise
            </Button>
            <Button disabled={disabled || busy} onClick={apply}>
              Apply cropped image
            </Button>
            <Button disabled={disabled || busy} onClick={() => setSource(null)}>
              Cancel crop
            </Button>
          </div>
        </>
      ) : (
        image && (
          <img
            className="admin-image"
            src={image}
            alt="Current draft attachment"
          />
        )
      )}
      {error && <ErrorNotice message={error} />}
    </section>
  );
}
