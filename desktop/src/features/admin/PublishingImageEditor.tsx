import { useEffect, useRef, useState } from "react";
import { Download, RotateCw, X } from "lucide-react";
import { Select } from "../../components/Select";
import { errorText } from "../../lib/errors";

/** Local raster editing: no image leaves the browser until the draft is saved. */
export function PublishingImageEditor({
  image,
  onApply,
  disabled,
}: {
  image: string | null;
  onApply: (image: string | null) => void;
  disabled: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [ratio, setRatio] = useState("wide");
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50),
    [y, setY] = useState(50);
  const [turn, setTurn] = useState(0);
  const [error, setError] = useState("");
  const load = async (url: string) => {
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (img.naturalWidth * img.naturalHeight > 40_000_000)
        throw new Error("Choose an image under 40 megapixels.");
      setSource(img);
      setZoom(1);
      setX(50);
      setY(50);
      setTurn(0);
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    const node = canvas.current;
    if (!node || !source) return;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    const width = 1200,
      height = ratio === "square" ? 1200 : ratio === "portrait" ? 1500 : 630;
    node.width = width;
    node.height = height;
    const sw = turn % 2 ? source.naturalHeight : source.naturalWidth;
    const sh = turn % 2 ? source.naturalWidth : source.naturalHeight;
    const scale = Math.max(width / sw, height / sh) * zoom;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(
      width / 2 + (width - sw * scale) * (x / 100 - 0.5),
      height / 2 + (height - sh * scale) * (y / 100 - 0.5),
    );
    ctx.rotate((turn * Math.PI) / 2);
    ctx.scale(scale, scale);
    ctx.drawImage(source, -source.naturalWidth / 2, -source.naturalHeight / 2);
    ctx.restore();
  }, [source, ratio, zoom, x, y, turn]);
  const output = () => {
    const data = canvas.current?.toDataURL("image/png");
    if (!data || data.length > 2_700_000) {
      setError(
        "The edited image exceeds 2 MB. Choose a smaller or simpler image.",
      );
      return null;
    }
    return data;
  };
  return (
    <section className="publishing-image">
      <div className="publishing-toolbar">
        <label className="secondary publishing-upload">
          Choose image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 12_000_000) {
                setError("Choose an image smaller than 12 MB.");
                return;
              }
              const url = URL.createObjectURL(file);
              try {
                await load(url);
              } finally {
                URL.revokeObjectURL(url);
              }
            }}
          />
        </label>
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => void load("/og-image.png")}
        >
          Brand image
        </button>
        {image && (
          <button
            className="icon-button"
            aria-label="Remove image"
            disabled={disabled}
            onClick={() => {
              onApply(null);
              setSource(null);
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {source ? (
        <>
          <canvas ref={canvas} aria-label="Image crop preview" />
          <div className="publishing-toolbar">
            <Select
              value={ratio}
              disabled={disabled}
              aria-label="Image size"
              onChange={(e) => setRatio(e.target.value)}
            >
              <option value="wide">1200 × 630</option>
              <option value="square">1200 × 1200</option>
              <option value="portrait">1200 × 1500</option>
            </Select>
            <button
              className="icon-button"
              disabled={disabled}
              aria-label="Rotate image"
              onClick={() => setTurn((t) => (t + 1) % 4)}
            >
              <RotateCw size={16} />
            </button>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => {
                const data = output();
                if (data) {
                  onApply(data);
                  setSource(null);
                }
              }}
            >
              Use image
            </button>
            <button className="text-button" onClick={() => setSource(null)}>
              Cancel
            </button>
          </div>
          {(
            [
              ["Zoom", zoom, setZoom, 1, 3, 0.01],
              ["Horizontal position", x, setX, 0, 100, 1],
              ["Vertical position", y, setY, 0, 100, 1],
            ] as const
          ).map(([label, value, set, min, max, step]) => (
            <label key={label}>
              {label}
              <input
                type="range"
                value={value}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onChange={(e) => set(Number(e.target.value))}
              />
            </label>
          ))}
        </>
      ) : (
        image && (
          <div className="publishing-image-current">
            <img src={image} alt="Draft attachment" />
            <a className="text-button" href={image} download="orbyn-update.png">
              <Download size={14} /> Download image
            </a>
          </div>
        )
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
