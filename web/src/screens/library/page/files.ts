import { IMAGE_MAX_SIDE } from "@orbyn/core";

/** A large photo is scaled before upload; a GIF keeps its frames. */
export async function scaledPicture(file: File, max = IMAGE_MAX_SIDE) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error("That picture couldn't be read."));
      next.src = url;
    });
    const { naturalWidth: width, naturalHeight: height } = image;
    if (Math.max(width, height) <= max || file.type === "image/gif")
      return { blob: file as Blob, width, height, type: file.type };
    const scale = max / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (made) =>
          made ? resolve(made) : reject(new Error("Couldn't scale it.")),
        type,
        0.86,
      ),
    );
    return { blob, width: canvas.width, height: canvas.height, type };
  } finally {
    URL.revokeObjectURL(url);
  }
}
